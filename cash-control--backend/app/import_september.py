"""Importa la hoja SEPTIEMBRE como historial mensual, sin inventar fechas diarias."""

import argparse
import hashlib
import re
from pathlib import Path

from openpyxl import load_workbook

from .db import connection, init_db


DEFAULT_SOURCE = Path(__file__).resolve().parents[2] / "docs/fuentes/CASH CONTROL - BRANLY RUIZ.xlsx"
PERIOD = "2026-09"


def _amount(sheet, address: str) -> int:
    value = sheet[address].value
    if not isinstance(value, (int, float)) or isinstance(value, bool) or int(value) != value:
        raise ValueError(f"{address}: se esperaba un importe entero; valor recibido: {value!r}")
    return int(value)


def _label(sheet, address: str) -> str:
    value = sheet[address].value
    return str(value).strip() if value is not None else ""


def _due_day(formula_sheet, row: int) -> int | None:
    formula = formula_sheet[f"H{row}"].value
    if not isinstance(formula, str):
        return None
    match = re.search(r"DATE\(YEAR\(TODAY\(\)\),MONTH\(TODAY\(\)\),(\d{1,2})\)", formula)
    return int(match.group(1)) if match else None


def read_september(source: Path) -> dict:
    if not source.is_file():
        raise FileNotFoundError(source)
    values_book = load_workbook(source, data_only=True, read_only=True)
    formulas_book = load_workbook(source, data_only=False, read_only=True)
    try:
        sheet = values_book["SEPTIEMBRE"]
        formulas = formulas_book["SEPTIEMBRE"]
        if "Septiembre 2026" not in str(formulas["B1"].value):
            raise ValueError("La hoja no corresponde a septiembre de 2026")

        income = [
            {"label": _label(sheet, f"B{row}"), "digital": _amount(sheet, f"C{row}"),
             "cash": _amount(sheet, f"D{row}"), "source_row": row}
            for row in range(24, 44) if _label(sheet, f"B{row}")
        ]
        fixed = [
            {"label": _label(sheet, f"G{row}"), "planned": _amount(sheet, f"I{row}"),
             "paid": _amount(sheet, f"J{row}"), "due_day": _due_day(formulas, row),
             "source_row": row}
            for row in range(27, 43) if _label(sheet, f"G{row}")
        ]
        variable = [
            {"label": _label(sheet, f"L{row}"), "digital": _amount(sheet, f"N{row}"),
             "cash": _amount(sheet, f"O{row}"), "source_row": row}
            for row in range(22, 40) if _label(sheet, f"L{row}")
        ]
        debts = []
        for direction, start, stop in (("payable", 21, 30), ("receivable", 33, 42)):
            for row in range(start, stop):
                label = _label(sheet, f"Q{row}")
                if label:
                    original = _amount(sheet, f"R{row}")
                    paid = _amount(sheet, f"S{row}")
                    balance = _amount(sheet, f"T{row}")
                    if original - paid != balance:
                        raise ValueError(f"Deuda en fila {row}: el saldo no concilia")
                    debts.append({"direction": direction, "label": label, "original": original,
                                  "paid": paid, "balance": balance, "source_row": row})

        opening_digital = _amount(sheet, "C22")
        opening_cash = _amount(sheet, "D22")
        if _amount(sheet, "C23") != 0:
            raise ValueError("La transferencia digital de septiembre cambió; revisar la importación")
        transfer = -_amount(sheet, "D23")
        closing_digital = opening_digital + sum(item["digital"] for item in income) + transfer \
            - sum(item["paid"] for item in fixed) - sum(item["digital"] for item in variable) \
            - sum(item["paid"] for item in debts if item["direction"] == "payable")
        closing_cash = opening_cash + sum(item["cash"] for item in income) - transfer \
            - sum(item["cash"] for item in variable)
        if (closing_digital, closing_cash) != (_amount(sheet, "G22"), _amount(sheet, "I22")):
            raise ValueError("Los saldos calculados no coinciden con la hoja de septiembre")

        return {
            "period": PERIOD, "opening_digital": opening_digital, "opening_cash": opening_cash,
            "transfer_cash_to_digital": transfer, "closing_digital": closing_digital,
            "closing_cash": closing_cash, "source_file": source.name,
            "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "income": income, "fixed_expenses": fixed, "variable_expenses": variable, "debts": debts,
        }
    finally:
        values_book.close()
        formulas_book.close()


def import_month(user_id: int, data: dict) -> int:
    """Inserta el mes una sola vez; un archivo cambiado requiere revisión antes de reemplazar."""
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        existing = db.execute(
            "SELECT id, source_sha256 FROM historical_months WHERE user_id = ? AND period = ?",
            (user_id, data["period"]),
        ).fetchone()
        if existing:
            if existing["source_sha256"] != data["source_sha256"]:
                raise ValueError("Ya existe septiembre importado desde otra versión del archivo")
            return existing["id"]
        cursor = db.execute(
            "INSERT INTO historical_months(user_id, period, opening_digital, opening_cash, "
            "transfer_cash_to_digital, closing_digital, closing_cash, source_file, source_sha256) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, data["period"], data["opening_digital"], data["opening_cash"],
             data["transfer_cash_to_digital"], data["closing_digital"], data["closing_cash"],
             data["source_file"], data["source_sha256"]),
        )
        month_id = cursor.lastrowid
        db.executemany(
            "INSERT INTO historical_income(month_id, label, digital, cash, source_row) VALUES (?, ?, ?, ?, ?)",
            [(month_id, item["label"], item["digital"], item["cash"], item["source_row"])
             for item in data["income"]],
        )
        db.executemany(
            "INSERT INTO historical_fixed_expenses(month_id, label, planned, paid, due_day, source_row) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [(month_id, item["label"], item["planned"], item["paid"], item["due_day"], item["source_row"])
             for item in data["fixed_expenses"]],
        )
        db.executemany(
            "INSERT INTO historical_variable_expenses(month_id, label, digital, cash, source_row) "
            "VALUES (?, ?, ?, ?, ?)",
            [(month_id, item["label"], item["digital"], item["cash"], item["source_row"])
             for item in data["variable_expenses"]],
        )
        db.executemany(
            "INSERT INTO historical_debts(month_id, direction, label, original, paid, balance, source_row) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(month_id, item["direction"], item["label"], item["original"], item["paid"],
              item["balance"], item["source_row"]) for item in data["debts"]],
        )
        return month_id


def main():
    parser = argparse.ArgumentParser(description="Importa SEPTIEMBRE 2026 desde el Excel al usuario de la app")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--user-email", help="Obligatorio si hay más de un usuario")
    args = parser.parse_args()
    init_db()
    with connection() as db:
        if args.user_email:
            row = db.execute("SELECT id FROM users WHERE email = ?", (args.user_email.strip().lower(),)).fetchone()
            if row is None:
                parser.error("No existe un usuario con ese correo")
            user_id = row["id"]
        else:
            rows = db.execute("SELECT id FROM users").fetchall()
            if len(rows) != 1:
                parser.error("Se requiere exactamente un usuario o --user-email")
            user_id = rows[0]["id"]
    data = read_september(args.source)
    month_id = import_month(user_id, data)
    print(f"Historial {data['period']} disponible como mes #{month_id}: "
          f"{len(data['income'])} ingresos, {len(data['fixed_expenses'])} gastos fijos, "
          f"{len(data['variable_expenses'])} gastos varios y {len(data['debts'])} deudas. "
          f"Cierre: digital {data['closing_digital']}, efectivo {data['closing_cash']}.")


if __name__ == "__main__":
    main()
