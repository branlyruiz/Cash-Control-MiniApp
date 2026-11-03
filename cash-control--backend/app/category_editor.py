"""Edición de conceptos y registros posteriores al historial importado."""

import sqlite3

from .category_views import KINDS, category_overview, category_preferences, visible_label
from .debt_ledger import debt_balances, validate_debt_ledger


def _editable_period(db: sqlite3.Connection, user_id: int, period: str) -> bool:
    latest = db.execute(
        "SELECT period FROM historical_months WHERE user_id = ? ORDER BY period DESC LIMIT 1", (user_id,)
    ).fetchone()
    return latest is None or period > latest["period"]


def _entry_rows(db: sqlite3.Connection, user_id: int, kind: str, period: str, label: str) -> list[dict]:
    preferences = category_preferences(db, user_id, kind)
    if kind in {"income", "fixed", "variable"}:
        clause = "kind = 'income'" if kind == "income" else "kind = 'expense' AND expense_class = 'fixed'" if kind == "fixed" else "kind = 'expense' AND (expense_class = 'variable' OR expense_class IS NULL)"
        rows = db.execute(
            f"SELECT id, occurred_on, category AS label, amount, account, description "
            f"FROM transactions WHERE user_id = ? AND substr(occurred_on, 1, 7) = ? AND {clause} "
            "ORDER BY occurred_on DESC, id DESC", (user_id, period),
        )
        entry_type = "transaction"
    else:
        rows = db.execute(
            "SELECT id, occurred_on, concept AS label, amount, NULL AS account, description "
            "FROM debts WHERE user_id = ? AND direction = ? AND substr(occurred_on, 1, 7) = ? "
            "ORDER BY occurred_on DESC, id DESC", (user_id, kind, period),
        )
        entry_type = "debt"
    entries = [{**dict(row), "entry_type": entry_type} for row in rows
               if visible_label(row["label"], preferences) == label]
    payment_direction = "receivable" if kind == "income" else kind if kind in {"payable", "receivable"} else None
    if payment_direction:
        payment_preferences = category_preferences(db, user_id, payment_direction)
        payments = db.execute(
            "SELECT id, occurred_on, concept AS label, amount, account, description FROM debt_payments "
            "WHERE user_id = ? AND direction = ? AND substr(occurred_on, 1, 7) = ? "
            "ORDER BY occurred_on DESC, id DESC", (user_id, payment_direction, period),
        )
        entries.extend({**dict(row), "entry_type": "payment"} for row in payments
                       if visible_label(row["label"], payment_preferences) == label)
    return entries


def concept_details(db: sqlite3.Connection, user_id: int, kind: str, period: str, label: str) -> dict:
    if kind not in KINDS:
        raise ValueError("Tipo inválido")
    overview = category_overview(db, user_id, kind, period)
    row = next((item for item in overview["rows"] if item["label"] == label), None)
    if row is None:
        raise LookupError("Concepto no encontrado")
    calculated = kind == "income" and label == "Disponible trasladado" and overview["carryover"] != 0
    editable = _editable_period(db, user_id, period) and not calculated
    entries = _entry_rows(db, user_id, kind, period, label) if editable else []
    receivable_concept = kind == "income" and label in debt_balances(db, user_id, "receivable", period)
    return {"label": label, "amount": row["amount"], "period": period, "kind": kind,
            "editable": editable, "calculated": calculated,
            "receivable_concept": receivable_concept, "planned": row["planned"], "entries": entries}


def set_fixed_plan(db: sqlite3.Connection, user_id: int, period: str, label: str, amount: int) -> dict:
    details = concept_details(db, user_id, "fixed", period, label)
    if not details["editable"]:
        raise ValueError("El historial importado no se puede editar")
    if amount < 0:
        raise ValueError("El valor previsto no puede ser negativo")
    db.execute(
        "INSERT INTO fixed_plans(user_id, effective_period, category, amount) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(user_id, effective_period, category) DO UPDATE SET amount = excluded.amount",
        (user_id, period, label, amount),
    )
    return {"category": label, "effective_period": period, "planned": amount}


def rename_concept(db: sqlite3.Connection, user_id: int, kind: str, period: str,
                   label: str, new_label: str) -> dict:
    details = concept_details(db, user_id, kind, period, label)
    if not details["editable"]:
        raise ValueError("Este concepto calculado o importado no se puede editar")
    if kind == "income" and details["receivable_concept"]:
        raise ValueError("Renombra este concepto desde Deudas a favor")
    new_label = new_label.strip()
    if not new_label or len(new_label) > 80:
        raise ValueError("Escribe un nombre de hasta 80 caracteres")
    if new_label.casefold() == "disponible trasladado":
        raise ValueError("Ese nombre está reservado para el saldo automático")
    if new_label.casefold() != label.casefold():
        other = category_overview(db, user_id, kind, period)["rows"]
        if any(row["label"].casefold() == new_label.casefold() for row in other):
            raise ValueError("Ya existe un concepto con ese nombre")
    preferences = category_preferences(db, user_id, kind)
    original = next((source for source, item in preferences.items() if item["display"] == label), label)
    db.execute(
        "INSERT INTO category_preferences(user_id, kind, original_label, display_label, hidden) "
        "VALUES (?, ?, ?, ?, 0) ON CONFLICT(user_id, kind, original_label) "
        "DO UPDATE SET display_label = excluded.display_label, hidden = 0",
        (user_id, kind, original, new_label),
    )
    db.execute(
        "UPDATE user_categories SET name = ? WHERE user_id = ? AND kind = ? AND name IN (?, ?)",
        (new_label, user_id, kind, label, original),
    )
    if kind in {"income", "fixed", "variable"}:
        clause = "kind = 'income'" if kind == "income" else "kind = 'expense' AND expense_class = 'fixed'" if kind == "fixed" else "kind = 'expense' AND (expense_class = 'variable' OR expense_class IS NULL)"
        db.execute(f"UPDATE transactions SET category = ? WHERE user_id = ? AND category IN (?, ?) AND {clause}",
                   (new_label, user_id, label, original))
        if kind == "fixed":
            db.execute("UPDATE fixed_due_days SET category = ? WHERE user_id = ? AND category IN (?, ?)",
                       (new_label, user_id, label, original))
            db.execute("UPDATE fixed_plans SET category = ? WHERE user_id = ? AND category IN (?, ?)",
                       (new_label, user_id, label, original))
    else:
        db.execute("UPDATE debts SET concept = ? WHERE user_id = ? AND direction = ? AND concept IN (?, ?)",
                   (new_label, user_id, kind, label, original))
        db.execute("UPDATE debt_payments SET concept = ? WHERE user_id = ? AND direction = ? AND concept IN (?, ?)",
                   (new_label, user_id, kind, label, original))
    return {"label": new_label}


def hide_concept(db: sqlite3.Connection, user_id: int, kind: str, period: str, label: str) -> dict:
    details = concept_details(db, user_id, kind, period, label)
    if not details["editable"]:
        raise ValueError("Este concepto calculado o importado no se puede eliminar")
    if kind == "income" and details["receivable_concept"]:
        raise ValueError("Gestiona este concepto desde Deudas a favor")
    if details["amount"] > sum(entry["amount"] for entry in details["entries"]):
        raise ValueError("Este concepto incluye un saldo heredado que no se puede eliminar aquí")
    for entry in details["entries"]:
        table = {"transaction": "transactions", "debt": "debts", "payment": "debt_payments"}[entry["entry_type"]]
        db.execute(f"DELETE FROM {table} WHERE id = ? AND user_id = ?", (entry["id"], user_id))
    if kind in {"payable", "receivable"}:
        validate_debt_ledger(db, user_id, kind, label)
    preferences = category_preferences(db, user_id, kind)
    original = next((source for source, item in preferences.items() if item["display"] == label), label)
    db.execute(
        "INSERT INTO category_preferences(user_id, kind, original_label, display_label, hidden) "
        "VALUES (?, ?, ?, ?, 1) ON CONFLICT(user_id, kind, original_label) "
        "DO UPDATE SET hidden = 1",
        (user_id, kind, original, label),
    )
    return {"deleted_entries": len(details["entries"])}


def change_entry_amount(db: sqlite3.Connection, user_id: int, entry_type: str, entry_id: int,
                        amount: int | None) -> dict:
    if entry_type not in {"transaction", "debt", "payment"}:
        raise ValueError("Tipo de registro inválido")
    table = {"transaction": "transactions", "debt": "debts", "payment": "debt_payments"}[entry_type]
    row = db.execute(f"SELECT * FROM {table} WHERE id = ? AND user_id = ?", (entry_id, user_id)).fetchone()
    if row is None:
        raise LookupError("Registro no encontrado")
    if amount is None:
        db.execute(f"DELETE FROM {table} WHERE id = ? AND user_id = ?", (entry_id, user_id))
        if entry_type == "debt":
            validate_debt_ledger(db, user_id, row["direction"], row["concept"])
        return {"deleted": True}
    if amount <= 0:
        raise ValueError("El valor debe ser mayor que cero")
    db.execute(f"UPDATE {table} SET amount = ? WHERE id = ? AND user_id = ?", (amount, entry_id, user_id))
    if entry_type in {"debt", "payment"}:
        validate_debt_ledger(db, user_id, row["direction"], row["concept"])
    return {"id": entry_id, "amount": amount}
