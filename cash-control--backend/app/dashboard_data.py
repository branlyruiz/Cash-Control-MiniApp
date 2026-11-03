"""Datos mensuales para la dashboard a partir del historial y los movimientos."""

import re
import sqlite3
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

from .debt_ledger import debt_balances


def _rows(db: sqlite3.Connection, table: str, month_id: int) -> list[sqlite3.Row]:
    return db.execute(f"SELECT * FROM {table} WHERE month_id = ? ORDER BY source_row", (month_id,)).fetchall()


def _historical_categories(fixed: list[sqlite3.Row], variable: list[sqlite3.Row], debts: list[sqlite3.Row]) -> list[dict]:
    # Reproduce las agrupaciones auxiliares L5:M16 de SEPTIEMBRE sin guardarlas
    # como movimientos adicionales. Esas agrupaciones combinan algunos importes
    # previstos con gastos registrados, igual que en el archivo original.
    planned = {row["source_row"]: row["planned"] for row in fixed}
    spent = {row["source_row"]: row["digital"] + row["cash"] for row in variable}
    debt_payments = sum(row["paid"] for row in debts if row["direction"] == "payable")

    def f(*numbers: int) -> int:
        return sum(planned.get(number, 0) for number in numbers)

    def v(*numbers: int) -> int:
        return sum(spent.get(number, 0) for number in numbers)

    return [
        {"label": "Créditos", "amount": f(36, 39)},
        {"label": "Ocio", "amount": f(34, 35, 40) + v(30, 31)},
        {"label": "Operativos", "amount": f(41, 30, 32, 37, 38) + v(34)},
        {"label": "Casa", "amount": f(27, 28, 29, 33) + v(25)},
        {"label": "Comida", "amount": v(26, 23)},
        {"label": "Mascotas", "amount": v(24)},
        {"label": "Ciclismo", "amount": v(27)},
        {"label": "Moto", "amount": v(29)},
        {"label": "Abonos deuda", "amount": debt_payments},
        {"label": "Gaming", "amount": v(35)},
        {"label": "Varios", "amount": v(22, 36, 37, 38, 39, 40, 41, 42)},
    ]


def _apply(balance: dict[str, int], row: sqlite3.Row):
    amount = row["amount"]
    if row["kind"] == "income":
        balance[row["account"]] += amount
    elif row["kind"] == "expense":
        balance[row["account"]] -= amount
    else:
        balance[row["account"]] -= amount
        balance[row["target_account"]] += amount


def dashboard_data(db: sqlite3.Connection, user_id: int, requested_period: str | None = None,
                   today_period: str | None = None) -> dict:
    periods = {
        row[0] for row in db.execute("SELECT period FROM historical_months WHERE user_id = ?", (user_id,))
    }
    periods.update(row[0] for row in db.execute(
        "SELECT DISTINCT substr(occurred_on, 1, 7) FROM transactions WHERE user_id = ?", (user_id,)
    ))
    periods.update(row[0] for row in db.execute(
        "SELECT DISTINCT substr(occurred_on, 1, 7) FROM debts WHERE user_id = ?", (user_id,)
    ))
    periods.update(row[0] for row in db.execute(
        "SELECT DISTINCT substr(occurred_on, 1, 7) FROM debt_payments WHERE user_id = ?", (user_id,)
    ))
    periods.add(max("2026-11", today_period or datetime.now(ZoneInfo("America/Bogota")).strftime("%Y-%m")))
    period = requested_period or max(periods)
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", period):
        raise ValueError("Periodo inválido")
    if period not in periods:
        periods.add(period)
    common = {"period": period, "periods": sorted(periods, reverse=True)}
    month = db.execute(
        "SELECT * FROM historical_months WHERE user_id = ? AND period = ?", (user_id, period)
    ).fetchone()
    if month:
        income = _rows(db, "historical_income", month["id"])
        fixed = _rows(db, "historical_fixed_expenses", month["id"])
        variable = _rows(db, "historical_variable_expenses", month["id"])
        debts = _rows(db, "historical_debts", month["id"])
        income_digital = sum(row["digital"] for row in income)
        income_cash = sum(row["cash"] for row in income)
        fixed_planned = sum(row["planned"] for row in fixed)
        fixed_paid = sum(row["paid"] for row in fixed)
        adjustments = db.execute(
            "SELECT account, amount FROM transactions WHERE user_id = ? AND kind = 'expense' "
            "AND expense_class = 'fixed' AND substr(occurred_on, 1, 7) = ?",
            (user_id, period),
        ).fetchall()
        fixed_paid += sum(row["amount"] for row in adjustments)
        closing = {"digital": month["closing_digital"], "cash": month["closing_cash"]}
        for row in adjustments:
            closing[row["account"]] -= row["amount"]
        variable_digital = sum(row["digital"] for row in variable)
        variable_cash = sum(row["cash"] for row in variable)
        payable_paid = sum(row["paid"] for row in debts if row["direction"] == "payable")
        return {
            **common,
            "source": "excel",
            "opening": {"digital": month["opening_digital"], "cash": month["opening_cash"]},
            "closing": closing,
            "income": {"digital": income_digital, "cash": income_cash},
            "carryover": 0,
            "fixed": {"planned": fixed_planned, "paid": fixed_paid},
            "variable": {"digital": variable_digital, "cash": variable_cash},
            "debt_payments": payable_paid,
            "debts": {
                "payable": sum(row["balance"] for row in debts if row["direction"] == "payable"),
                "receivable": sum(row["balance"] for row in debts if row["direction"] == "receivable"),
            },
            "transfer_cash_to_digital": month["transfer_cash_to_digital"],
            "categories": _historical_categories(fixed, variable, debts),
        }

    baseline = db.execute(
        "SELECT period, closing_digital, closing_cash FROM historical_months "
        "WHERE user_id = ? AND period < ? ORDER BY period DESC LIMIT 1", (user_id, period)
    ).fetchone()
    balance = {"digital": baseline["closing_digital"] if baseline else 0,
               "cash": baseline["closing_cash"] if baseline else 0}
    transaction_cutoff = baseline["period"] + "-00" if baseline else "0000-00-00"
    payment_cutoff = baseline["period"] + "-31" if baseline else "0000-00-00"
    for row in db.execute(
        "SELECT kind, account, target_account, amount FROM transactions "
        "WHERE user_id = ? AND occurred_on > ? AND occurred_on < ? ORDER BY occurred_on, id",
        (user_id, transaction_cutoff, period + "-01"),
    ):
        _apply(balance, row)
    for row in db.execute(
        "SELECT direction, account, amount FROM debt_payments WHERE user_id = ? "
        "AND occurred_on > ? AND occurred_on < ?", (user_id, payment_cutoff, period + "-01"),
    ):
        balance[row["account"]] += row["amount"] if row["direction"] == "receivable" else -row["amount"]
    opening = balance.copy()
    income = {"digital": 0, "cash": 0}
    variable = {"digital": 0, "cash": 0}
    fixed_paid = 0
    category_amounts: dict[str, int] = defaultdict(int)
    transfer_cash_to_digital = 0
    paid_debts = 0
    for row in db.execute(
        "SELECT kind, account, target_account, expense_class, category, amount FROM transactions "
        "WHERE user_id = ? AND substr(occurred_on, 1, 7) = ? ORDER BY occurred_on, id",
        (user_id, period),
    ):
        _apply(balance, row)
        if row["kind"] == "income":
            income[row["account"]] += row["amount"]
        elif row["kind"] == "expense":
            category_amounts[row["category"]] += row["amount"]
            if row["expense_class"] == "fixed":
                fixed_paid += row["amount"]
            else:
                variable[row["account"]] += row["amount"]
        else:
            transfer_cash_to_digital += row["amount"] if row["account"] == "cash" else -row["amount"]
    for row in db.execute(
        "SELECT direction, account, amount FROM debt_payments WHERE user_id = ? "
        "AND substr(occurred_on, 1, 7) = ?", (user_id, period),
    ):
        if row["direction"] == "receivable":
            balance[row["account"]] += row["amount"]
            income[row["account"]] += row["amount"]
        else:
            balance[row["account"]] -= row["amount"]
            paid_debts += row["amount"]
            category_amounts["Abonos deuda"] += row["amount"]
    previous_debts = {
        "payable": sum(debt_balances(db, user_id, "payable", period).values()),
        "receivable": sum(debt_balances(db, user_id, "receivable", period).values()),
    }
    from .category_views import _fixed_template
    planned_fixed = sum(item["planned"] for item in _fixed_template(db, user_id, period).values())
    return {
        **common, "source": "movements", "opening": opening, "closing": balance,
        "income": income, "carryover": opening["digital"] + opening["cash"],
        "fixed": {"planned": planned_fixed, "paid": fixed_paid},
        "variable": variable, "debt_payments": paid_debts, "debts": previous_debts,
        "transfer_cash_to_digital": transfer_cash_to_digital,
        "categories": [
            {"label": label, "amount": amount}
            for label, amount in sorted(category_amounts.items(), key=lambda item: item[1], reverse=True)
        ],
    }
