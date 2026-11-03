"""Saldos y abonos de deudas posteriores al historial importado."""

import calendar
import sqlite3
from collections import defaultdict


def _aliases(db: sqlite3.Connection, user_id: int, direction: str) -> dict[str, str]:
    return {row["original_label"]: row["display_label"] for row in db.execute(
        "SELECT original_label, display_label FROM category_preferences WHERE user_id = ? AND kind = ?",
        (user_id, direction),
    )}


def debt_balances(db: sqlite3.Connection, user_id: int, direction: str, period: str, through_date: str | None = None) -> dict[str, int]:
    """Saldos al cierre de un mes; los abonos restan, las deudas nuevas suman."""
    if direction not in {"payable", "receivable"}:
        raise ValueError("Tipo de deuda inválido")
    aliases = _aliases(db, user_id, direction)
    amounts: dict[str, int] = defaultdict(int)
    month = db.execute(
        "SELECT id, period FROM historical_months WHERE user_id = ? AND period <= ? "
        "ORDER BY period DESC LIMIT 1", (user_id, period),
    ).fetchone()
    if month:
        for row in db.execute(
            "SELECT label, balance FROM historical_debts WHERE month_id = ? AND direction = ?",
            (month["id"], direction),
        ):
            amounts[aliases.get(row["label"], row["label"])] += row["balance"]
    cutoff = f"{month['period']}-{calendar.monthrange(*map(int, month['period'].split('-')))[1]:02d}" if month else "0000-00-00"
    through = through_date + "~" if through_date else period + "-32"
    for row in db.execute(
        "SELECT concept, amount FROM debts WHERE user_id = ? AND direction = ? "
        "AND occurred_on > ? AND occurred_on < ?", (user_id, direction, cutoff, through),
    ):
        amounts[aliases.get(row["concept"], row["concept"])] += row["amount"]
    for row in db.execute(
        "SELECT concept, amount FROM debt_payments WHERE user_id = ? AND direction = ? "
        "AND occurred_on > ? AND occurred_on < ?", (user_id, direction, cutoff, through),
    ):
        amounts[aliases.get(row["concept"], row["concept"])] -= row["amount"]
    return dict(amounts)


def validate_debt_ledger(db: sqlite3.Connection, user_id: int, direction: str, concept: str):
    """Revisa también pagos futuros para evitar saldos negativos tras una edición."""
    aliases = _aliases(db, user_id, direction)
    month = db.execute(
        "SELECT id, period FROM historical_months WHERE user_id = ? ORDER BY period DESC LIMIT 1", (user_id,)
    ).fetchone()
    balance = 0
    if month:
        for row in db.execute(
            "SELECT label, balance FROM historical_debts WHERE month_id = ? AND direction = ?",
            (month["id"], direction),
        ):
            if aliases.get(row["label"], row["label"]) == concept:
                balance += row["balance"]
    cutoff = f"{month['period']}-{calendar.monthrange(*map(int, month['period'].split('-')))[1]:02d}" if month else "0000-00-00"
    events = []
    for row in db.execute(
        "SELECT occurred_on, concept, amount FROM debts WHERE user_id = ? AND direction = ? AND occurred_on > ?",
        (user_id, direction, cutoff),
    ):
        if aliases.get(row["concept"], row["concept"]) == concept:
            events.append((row["occurred_on"], 0, row["amount"]))
    for row in db.execute(
        "SELECT occurred_on, concept, amount FROM debt_payments WHERE user_id = ? AND direction = ? AND occurred_on > ?",
        (user_id, direction, cutoff),
    ):
        if aliases.get(row["concept"], row["concept"]) == concept:
            events.append((row["occurred_on"], 1, -row["amount"]))
    for _date, _order, change in sorted(events):
        balance += change
        if balance < 0:
            raise ValueError("El abono supera el saldo pendiente de la deuda")
