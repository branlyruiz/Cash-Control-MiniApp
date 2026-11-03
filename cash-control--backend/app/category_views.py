"""Resúmenes por tipo y vencimientos mensuales de gastos fijos."""

import calendar
import re
import sqlite3
from collections import defaultdict
from datetime import date, datetime
from zoneinfo import ZoneInfo

from .dashboard_data import dashboard_data
from .debt_ledger import debt_balances

KINDS = {"income", "variable", "fixed", "payable", "receivable"}


def category_preferences(db: sqlite3.Connection, user_id: int, kind: str) -> dict[str, dict]:
    return {row["original_label"]: {"display": row["display_label"], "hidden": bool(row["hidden"])}
            for row in db.execute(
                "SELECT original_label, display_label, hidden FROM category_preferences WHERE user_id = ? AND kind = ?",
                (user_id, kind),
            )}


def visible_label(label: str, preferences: dict[str, dict]) -> str:
    return preferences.get(label, {}).get("display", label)


def is_hidden(label: str, preferences: dict[str, dict]) -> bool:
    return any((original == label or item["display"] == label) and item["hidden"]
               for original, item in preferences.items())


def _fixed_template(db: sqlite3.Connection, user_id: int, period: str | None = None) -> dict[str, dict]:
    month = db.execute("SELECT id FROM historical_months WHERE user_id = ? ORDER BY period DESC LIMIT 1", (user_id,)).fetchone()
    template = {}
    preferences = category_preferences(db, user_id, "fixed")
    if month:
        for row in db.execute(
            "SELECT label, planned, due_day FROM historical_fixed_expenses WHERE month_id = ?", (month["id"],)
        ):
            if not is_hidden(row["label"], preferences):
                template[visible_label(row["label"], preferences)] = {"planned": row["planned"], "due_day": row["due_day"]}
    for row in db.execute("SELECT category, due_day FROM fixed_due_days WHERE user_id = ?", (user_id,)):
        if not is_hidden(row["category"], preferences):
            template.setdefault(visible_label(row["category"], preferences), {"planned": 0, "due_day": None})["due_day"] = row["due_day"]
    for row in db.execute("SELECT name FROM user_categories WHERE user_id = ? AND kind = 'fixed'", (user_id,)):
        if not is_hidden(row["name"], preferences):
            template.setdefault(visible_label(row["name"], preferences), {"planned": 0, "due_day": None})
    if period:
        for row in db.execute(
            "SELECT category, amount FROM fixed_plans WHERE user_id = ? AND effective_period <= ? "
            "ORDER BY effective_period", (user_id, period),
        ):
            if not is_hidden(row["category"], preferences):
                template.setdefault(visible_label(row["category"], preferences), {"planned": 0, "due_day": None})["planned"] = row["amount"]
    return template


def fixed_schedule(db: sqlite3.Connection, user_id: int, today: date | None = None,
                   period: str | None = None) -> list[dict]:
    today = today or datetime.now(ZoneInfo("America/Bogota")).date()
    period = period or today.strftime("%Y-%m")
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", period):
        raise ValueError("Período inválido")
    year, month_number = map(int, period.split("-"))
    month_end = date(year, month_number, calendar.monthrange(year, month_number)[1])
    reference_day = min(today, month_end)
    template = _fixed_template(db, user_id, period)
    preferences = category_preferences(db, user_id, "fixed")
    for row in db.execute("SELECT DISTINCT category FROM transactions WHERE user_id = ? AND expense_class = 'fixed'", (user_id,)):
        if not is_hidden(row["category"], preferences):
            template.setdefault(visible_label(row["category"], preferences), {"planned": 0, "due_day": None})
    paid = defaultdict(int)
    month = db.execute("SELECT id FROM historical_months WHERE user_id = ? AND period = ?", (user_id, period)).fetchone()
    if month:
        for row in db.execute("SELECT label, paid FROM historical_fixed_expenses WHERE month_id = ?", (month["id"],)):
            paid[visible_label(row["label"], preferences)] += row["paid"]
    for row in db.execute(
        "SELECT category, SUM(amount) AS amount FROM transactions WHERE user_id = ? "
        "AND expense_class = 'fixed' AND substr(occurred_on, 1, 7) = ? GROUP BY category", (user_id, period)
    ):
        paid[visible_label(row["category"], preferences)] += row["amount"]
    result = []
    for label, info in template.items():
        day = info["due_day"]
        due = date(year, month_number, min(day, month_end.day)) if day else None
        remaining = (due - reference_day).days if due else None
        amount_paid = paid[label]
        planned = info["planned"]
        # La hoja registra abonos reales que pueden diferir ligeramente del valor previsto.
        settled = amount_paid > 0
        result.append({
            "label": label, "planned": planned, "paid": amount_paid, "due_day": day,
            "due_date": due.isoformat() if due else None, "days_remaining": remaining,
            "status": "paid" if settled else "unset" if day is None else "overdue" if remaining < 0
                      else "urgent" if remaining < 3 else "upcoming",
        })
    return sorted(result, key=lambda item: (item["days_remaining"] is None, item["days_remaining"] if item["days_remaining"] is not None else 999, item["label"]))


def category_overview(db: sqlite3.Connection, user_id: int, kind: str, period: str) -> dict:
    if kind not in KINDS:
        raise ValueError("Tipo inválido")
    if len(period) != 7 or period[4] != "-" or not period[:4].isdigit() or period[5:] not in [f"{n:02d}" for n in range(1, 13)]:
        raise ValueError("Período inválido")
    amounts = defaultdict(int)
    planned = defaultdict(int)
    carryover = 0
    month = db.execute("SELECT id FROM historical_months WHERE user_id = ? AND period = ?", (user_id, period)).fetchone()
    preferences = {} if month else category_preferences(db, user_id, kind)
    show = lambda label: visible_label(label, preferences)
    if month:
        if kind in {"income", "variable"}:
            table = "historical_income" if kind == "income" else "historical_variable_expenses"
            for row in db.execute(f"SELECT label, digital, cash FROM {table} WHERE month_id = ?", (month["id"],)):
                amounts[row["label"]] += row["digital"] + row["cash"]
        elif kind == "fixed":
            for row in db.execute("SELECT label, planned, paid FROM historical_fixed_expenses WHERE month_id = ?", (month["id"],)):
                amounts[row["label"]] += row["paid"]
                planned[row["label"]] += row["planned"]
            for row in db.execute(
                "SELECT category, SUM(amount) AS amount FROM transactions WHERE user_id = ? "
                "AND kind = 'expense' AND expense_class = 'fixed' AND substr(occurred_on, 1, 7) = ? "
                "GROUP BY category", (user_id, period),
            ):
                amounts[row["category"]] += row["amount"]
        else:
            for row in db.execute("SELECT label, balance FROM historical_debts WHERE month_id = ? AND direction = ?", (month["id"], kind)):
                amounts[row["label"]] += row["balance"]
    elif kind in {"income", "variable", "fixed"}:
        clause = "kind = 'income'" if kind == "income" else f"kind = 'expense' AND {'expense_class = \'fixed\'' if kind == 'fixed' else '(expense_class = \'variable\' OR expense_class IS NULL)'}"
        for row in db.execute(
            f"SELECT category, SUM(amount) AS amount FROM transactions WHERE user_id = ? AND substr(occurred_on, 1, 7) = ? AND {clause} GROUP BY category",
            (user_id, period),
        ):
            amounts[show(row["category"])] += row["amount"]
        if kind == "income":
            receivable_aliases = category_preferences(db, user_id, "receivable")
            for row in db.execute(
                "SELECT concept, SUM(amount) AS amount FROM debt_payments WHERE user_id = ? "
                "AND direction = 'receivable' AND substr(occurred_on, 1, 7) = ? GROUP BY concept",
                (user_id, period),
            ):
                amounts[visible_label(row["concept"], receivable_aliases)] += row["amount"]
            carryover = dashboard_data(db, user_id, period)["carryover"]
            if carryover:
                amounts["Disponible trasladado"] += carryover
    else:
        amounts.update(debt_balances(db, user_id, kind, period))
    if kind == "fixed" and not month:
        for label, item in _fixed_template(db, user_id, period).items():
            planned[label] = item["planned"]
            amounts[label] += 0
    if not month:
        historical_table = {
            "income": "historical_income", "variable": "historical_variable_expenses",
            "fixed": "historical_fixed_expenses", "payable": "historical_debts",
            "receivable": "historical_debts",
        }[kind]
        direction_clause = " AND i.direction = ?" if kind in {"payable", "receivable"} else ""
        parameters = (user_id, kind) if direction_clause else (user_id,)
        for row in db.execute(
            f"SELECT DISTINCT i.label FROM {historical_table} i "
            f"JOIN historical_months m ON m.id = i.month_id WHERE m.user_id = ?{direction_clause}",
            parameters,
        ):
            if not is_hidden(row["label"], preferences):
                amounts[show(row["label"])] += 0
        if kind in {"income", "variable", "fixed"}:
            condition = "kind = 'income'" if kind == "income" else "kind = 'expense' AND expense_class = 'fixed'" if kind == "fixed" else "kind = 'expense' AND (expense_class = 'variable' OR expense_class IS NULL)"
            params = (user_id,)
            for row in db.execute(f"SELECT DISTINCT category FROM transactions WHERE user_id = ? AND {condition}", params):
                if not is_hidden(row["category"], preferences):
                    amounts[show(row["category"])] += 0
        else:
            for row in db.execute("SELECT DISTINCT concept FROM debts WHERE user_id = ? AND direction = ?", (user_id, kind)):
                if not is_hidden(row["concept"], preferences):
                    amounts[show(row["concept"])] += 0
        for row in db.execute("SELECT name FROM user_categories WHERE user_id = ? AND kind = ?", (user_id, kind)):
            if not is_hidden(row["name"], preferences):
                amounts[show(row["name"])] += 0
        if kind == "income":
            receivable_preferences = category_preferences(db, user_id, "receivable")
            for row in db.execute(
                "SELECT DISTINCT i.label FROM historical_debts i JOIN historical_months m ON m.id = i.month_id "
                "WHERE m.user_id = ? AND i.direction = 'receivable'", (user_id,),
            ):
                if not is_hidden(row["label"], receivable_preferences):
                    amounts[visible_label(row["label"], receivable_preferences)] += 0
            for row in db.execute("SELECT name FROM user_categories WHERE user_id = ? AND kind = 'receivable'", (user_id,)):
                if not is_hidden(row["name"], receivable_preferences):
                    amounts[visible_label(row["name"], receivable_preferences)] += 0
    rows = [{"label": label, "amount": amount, "planned": planned[label] if kind == "fixed" else None}
            for label, amount in amounts.items()]
    rows.sort(key=lambda row: (-row["amount"], row["label"].casefold()))
    return {"kind": kind, "period": period, "total": sum(row["amount"] for row in rows),
            "carryover": carryover, "rows": rows}
