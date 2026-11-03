import os
import tempfile
import unittest
from datetime import date
from pathlib import Path

from fastapi import HTTPException

from app.db import connection, init_db
from app.dashboard_data import dashboard_data
from app.category_views import category_overview, fixed_schedule
from app.category_editor import concept_details, rename_concept, hide_concept, change_entry_amount
from app.import_september import DEFAULT_SOURCE, import_month, read_september
from app.main import (
    DebtInput, DebtPaymentInput, LatestEntryInput, TransactionInput, categories, create_debt,
    create_debt_payment, create_transaction, confirm_fixed_payment, FixedPaymentInput,
    debts, delete_concept_entry, delete_latest_entry, get_dashboard_data, get_debt_balances, historical_month, latest_entry,
    set_fixed_due_day, update_fixed_plan, DueDayInput, FixedPlanInput, summary, transactions,
)


class SeptemberImportTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous_path = os.environ.get("CASH_CONTROL_DB")
        os.environ["CASH_CONTROL_DB"] = str(Path(self.temp.name) / "test.sqlite3")
        init_db()
        with connection() as db:
            db.execute("INSERT INTO users(email, password_hash) VALUES (?, ?)", ("test@example.com", "test"))

    def tearDown(self):
        if self.previous_path is None:
            os.environ.pop("CASH_CONTROL_DB", None)
        else:
            os.environ["CASH_CONTROL_DB"] = self.previous_path
        self.temp.cleanup()

    def test_import_reconciles_and_carries_closing_balance(self):
        data = read_september(DEFAULT_SOURCE)
        self.assertEqual((data["closing_digital"], data["closing_cash"]), (149156, 0))
        month_id = import_month(1, data)
        self.assertEqual(import_month(1, data), month_id)
        history = historical_month("2026-09", 1)
        self.assertEqual(
            tuple(len(history[key]) for key in ("income", "fixed_expenses", "variable_expenses", "debts")),
            (10, 15, 15, 9),
        )
        self.assertEqual(summary(1)["total"], 149156)
        with self.assertRaises(HTTPException) as error:
            create_transaction(TransactionInput(
                occurred_on=date(2026, 9, 30), kind="expense", account="digital",
                category="Varios", expense_class="variable", amount=1000,
            ), 1)
        self.assertEqual(error.exception.status_code, 422)
        create_transaction(TransactionInput(
            occurred_on=date(2026, 10, 1), kind="expense", account="digital",
            category="Varios", expense_class="variable", amount=1000,
        ), 1)
        self.assertEqual(summary(1)["digital"], 148156)

    def test_categories_depend_on_type_and_new_debt_concept_is_saved(self):
        import_month(1, read_september(DEFAULT_SOURCE))
        options = categories(1)
        self.assertIn("PADRE ARRIENDO", options["income"])
        self.assertIn("ARRIENDO", options["fixed"])
        self.assertIn("ALMUERZOS - CENA", options["variable"])
        self.assertNotIn("ARRIENDO", options["income"])
        self.assertIn("LLANTAS MTB", options["payable"])
        self.assertIn("Sebastian", options["receivable"])

        with self.assertRaises(HTTPException) as error:
            create_transaction(TransactionInput(
                occurred_on=date(2026, 10, 1), kind="income", account="digital",
                category="ARRIENDO", amount=2000,
            ), 1)
        self.assertEqual(error.exception.status_code, 422)

        create_transaction(TransactionInput(
            occurred_on=date(2026, 10, 1), kind="expense", account="digital",
            category="ARRIENDO", expense_class="fixed", amount=5000,
        ), 1)
        self.assertEqual(transactions(1)[0]["expense_class"], "fixed")
        balance_before_debt = summary(1)["total"]
        create_debt(DebtInput(
            occurred_on=date(2026, 10, 1), direction="payable",
            concept="Reparación portátil", amount=120000,
        ), 1)
        self.assertEqual(debts(1)[0]["concept"], "Reparación portátil")
        self.assertIn("Reparación portátil", categories(1)["payable"])
        create_debt(DebtInput(
            occurred_on=date(2026, 10, 2), direction="receivable",
            concept="Préstamo vecino", amount=80000,
        ), 1)
        self.assertIn("Préstamo vecino", categories(1)["receivable"])
        self.assertNotIn("Préstamo vecino", categories(1)["payable"])
        self.assertEqual(summary(1)["total"], balance_before_debt)

    def test_dashboard_matches_excel_and_updates_next_month(self):
        import_month(1, read_september(DEFAULT_SOURCE))
        september = get_dashboard_data("2026-09", 1)
        self.assertEqual(september["opening"], {"digital": 245564, "cash": 2176000})
        self.assertEqual(september["closing"], {"digital": 149156, "cash": 0})
        self.assertEqual(september["income"], {"digital": 1904000, "cash": 200000})
        self.assertEqual(september["fixed"], {"planned": 1578033, "paid": 1755406})
        self.assertEqual(september["variable"], {"digital": 1785002, "cash": 836000})
        self.assertEqual(september["debts"], {"payable": 745000, "receivable": 2095500})
        self.assertEqual(sum(item["amount"] for item in september["categories"]), 3836383)

        create_transaction(TransactionInput(
            occurred_on=date(2026, 10, 2), kind="income", account="digital",
            category="Otros ingresos", amount=100000,
        ), 1)
        create_transaction(TransactionInput(
            occurred_on=date(2026, 10, 3), kind="expense", account="cash",
            category="Varios", expense_class="variable", amount=20000,
        ), 1)
        create_debt(DebtInput(
            occurred_on=date(2026, 10, 4), direction="payable", concept="Reparación", amount=30000,
        ), 1)
        october = get_dashboard_data("2026-10", 1)
        self.assertEqual(october["opening"], september["closing"])
        self.assertEqual(october["closing"], {"digital": 249156, "cash": -20000})
        self.assertEqual(october["categories"], [{"label": "Varios", "amount": 20000}])
        self.assertEqual(october["debts"]["payable"], 775000)
        self.assertEqual(october["periods"], ["2026-10", "2026-09"])

    def test_undo_only_latest_entry_across_movements_and_debts(self):
        import_month(1, read_september(DEFAULT_SOURCE))
        self.assertIsNone(latest_entry(1))
        movement = create_transaction(TransactionInput(
            occurred_on=date(2026, 10, 2), kind="expense", account="digital",
            category="Varios", expense_class="variable", amount=1000,
        ), 1)
        debt = create_debt(DebtInput(
            occurred_on=date(2026, 10, 1), direction="payable", concept="Error", amount=5000,
        ), 1)
        self.assertEqual(latest_entry(1)["entry_type"], "debt")
        with self.assertRaises(HTTPException) as error:
            delete_latest_entry(LatestEntryInput(entry_type="transaction", id=movement["id"]), 1)
        self.assertEqual(error.exception.status_code, 409)
        delete_latest_entry(LatestEntryInput(entry_type="debt", id=debt["id"]), 1)
        self.assertEqual(latest_entry(1)["entry_type"], "transaction")
        self.assertEqual(summary(1)["digital"], 148156)
        delete_latest_entry(LatestEntryInput(entry_type="transaction", id=movement["id"]), 1)
        self.assertIsNone(latest_entry(1))
        self.assertEqual(summary(1)["digital"], 149156)

    def test_fixed_due_countdown_and_category_summaries(self):
        import_month(1, read_september(DEFAULT_SOURCE))
        with connection() as db:
            september_due = {item["label"]: item for item in fixed_schedule(db, 1, date(2026, 9, 30))}
            self.assertEqual(september_due["EMPOAGUAS"]["status"], "paid")
            self.assertEqual(september_due["CLARO"]["status"], "paid")
            self.assertEqual(september_due["APORTE FACREDIG"]["status"], "overdue")
            self.assertEqual(september_due["CREDITO ESPECIAL"]["status"], "overdue")
            upcoming = fixed_schedule(db, 1, date(2026, 10, 22))
            rent = next(item for item in upcoming if item["label"] == "ARRIENDO")
            self.assertEqual((rent["days_remaining"], rent["status"]), (2, "urgent"))
            self.assertEqual(category_overview(db, 1, "income", "2026-09")["total"], 2104000)
            self.assertEqual(category_overview(db, 1, "fixed", "2026-09")["total"], 1755406)
        create_transaction(TransactionInput(
            occurred_on=date(2026, 10, 22), kind="expense", account="digital",
            category="ARRIENDO", expense_class="fixed", amount=550000,
        ), 1)
        with connection() as db:
            paid = fixed_schedule(db, 1, date(2026, 10, 22))
            self.assertEqual(next(item for item in paid if item["label"] == "ARRIENDO")["status"], "paid")
            self.assertEqual(category_overview(db, 1, "fixed", "2026-10")["total"], 550000)
        set_fixed_due_day("ARRIENDO", DueDayInput(due_day=28), 1)
        with connection() as db:
            revised = fixed_schedule(db, 1, date(2026, 11, 26))
            rent = next(item for item in revised if item["label"] == "ARRIENDO")
            self.assertEqual((rent["due_day"], rent["days_remaining"], rent["status"]), (28, 2, "urgent"))

    def test_fixed_schedule_resets_for_selected_month(self):
        import_month(1, read_september(DEFAULT_SOURCE))
        with connection() as db:
            september = {item["label"]: item for item in fixed_schedule(db, 1, date(2026, 9, 30), "2026-09")}
            october = {item["label"]: item for item in fixed_schedule(db, 1, date(2026, 9, 30), "2026-10")}
            self.assertEqual(september["EMPOAGUAS"]["status"], "paid")
            self.assertNotEqual(october["EMPOAGUAS"]["status"], "paid")
            self.assertTrue(october["EMPOAGUAS"]["due_date"].startswith("2026-10-"))
            self.assertEqual(october["EMPOAGUAS"]["paid"], 0)
            next_day = {item["label"]: item for item in fixed_schedule(db, 1, date(2026, 10, 1), "2026-10")}
            self.assertEqual(october["EMPOAGUAS"]["days_remaining"] - next_day["EMPOAGUAS"]["days_remaining"], 1)
        create_transaction(TransactionInput(
            occurred_on=date(2026, 10, 2), kind="expense", account="digital",
            category="EMPOAGUAS", expense_class="fixed", amount=10000,
        ), 1)
        with connection() as db:
            october_paid = {item["label"]: item for item in fixed_schedule(db, 1, date(2026, 10, 3), "2026-10")}
            november = {item["label"]: item for item in fixed_schedule(db, 1, date(2026, 11, 1), "2026-11")}
            self.assertEqual((october_paid["EMPOAGUAS"]["status"], october_paid["EMPOAGUAS"]["paid"]), ("paid", 10000))
            self.assertNotEqual(november["EMPOAGUAS"]["status"], "paid")
            self.assertEqual(november["EMPOAGUAS"]["paid"], 0)

    def test_dashboard_fixed_payment_updates_imported_month_and_next_opening(self):
        import_month(1, read_september(DEFAULT_SOURCE))
        with connection() as db:
            pending = next(item for item in fixed_schedule(db, 1, date(2026, 9, 30), "2026-09")
                           if item["label"] == "APORTE FACREDIG")
            september_before = dashboard_data(db, 1, "2026-09")
            fixed_before = next(row["amount"] for row in category_overview(db, 1, "fixed", "2026-09")["rows"]
                                if row["label"] == "APORTE FACREDIG")
        amount = pending["planned"]
        self.assertGreater(amount, 0)
        created = confirm_fixed_payment(FixedPaymentInput(
            period="2026-09", occurred_on=date(2026, 9, 30),
            category="APORTE FACREDIG", account="digital",
        ), 1)
        self.assertEqual(created["amount"], amount)
        with connection() as db:
            september = dashboard_data(db, 1, "2026-09")
            october = dashboard_data(db, 1, "2026-10")
            fixed_after = next(row["amount"] for row in category_overview(db, 1, "fixed", "2026-09")["rows"]
                               if row["label"] == "APORTE FACREDIG")
            schedule = next(item for item in fixed_schedule(db, 1, date(2026, 9, 30), "2026-09")
                            if item["label"] == "APORTE FACREDIG")
            imported = db.execute("SELECT paid FROM historical_fixed_expenses WHERE label = 'APORTE FACREDIG'").fetchone()["paid"]
        self.assertEqual(imported, 0)
        self.assertEqual(september["closing"]["digital"], september_before["closing"]["digital"] - amount)
        self.assertEqual(september["fixed"]["paid"], september_before["fixed"]["paid"] + amount)
        self.assertEqual(october["opening"], september["closing"])
        self.assertEqual(summary(1)["total"], sum(september["closing"].values()))
        self.assertEqual(fixed_after, fixed_before + amount)
        self.assertEqual(schedule["status"], "paid")
        with self.assertRaises(HTTPException) as duplicate:
            confirm_fixed_payment(FixedPaymentInput(
                period="2026-09", occurred_on=date(2026, 9, 30),
                category="APORTE FACREDIG", account="digital",
            ), 1)
        self.assertEqual(duplicate.exception.status_code, 409)
        delete_concept_entry("transaction", created["id"], 1)
        self.assertEqual(summary(1)["total"], sum(september_before["closing"].values()))

    def test_fixed_plan_changes_from_selected_month_without_changing_payments(self):
        import_month(1, read_september(DEFAULT_SOURCE))
        with connection() as db:
            imported = next(row for row in category_overview(db, 1, "fixed", "2026-09")["rows"] if row["label"] == "ARRIENDO")
            original = imported["planned"]
        with self.assertRaises(HTTPException) as error:
            update_fixed_plan("ARRIENDO", "2026-09", FixedPlanInput(amount=600000), 1)
        self.assertEqual(error.exception.status_code, 422)
        update_fixed_plan("ARRIENDO", "2026-10", FixedPlanInput(amount=600000), 1)
        with connection() as db:
            september = next(row for row in category_overview(db, 1, "fixed", "2026-09")["rows"] if row["label"] == "ARRIENDO")
            october = next(row for row in category_overview(db, 1, "fixed", "2026-10")["rows"] if row["label"] == "ARRIENDO")
            november = next(row for row in category_overview(db, 1, "fixed", "2026-11")["rows"] if row["label"] == "ARRIENDO")
            schedule = next(row for row in fixed_schedule(db, 1, date(2026, 10, 1)) if row["label"] == "ARRIENDO")
            self.assertEqual(september["planned"], original)
            self.assertEqual((october["planned"], october["amount"], november["planned"]), (600000, 0, 600000))
            self.assertEqual(schedule["planned"], 600000)
            self.assertEqual(dashboard_data(db, 1, "2026-10")["fixed"]["planned"], sum(row["planned"] for row in category_overview(db, 1, "fixed", "2026-10")["rows"]))

    def test_month_rollover_and_all_variable_concepts(self):
        import_month(1, read_september(DEFAULT_SOURCE))
        with connection() as db:
            october = dashboard_data(db, 1, today_period="2026-10")
            self.assertEqual(october["period"], "2026-10")
            self.assertEqual(october["opening"], {"digital": 149156, "cash": 0})
            self.assertEqual(october["carryover"], 149156)
            self.assertEqual(october["income"], {"digital": 0, "cash": 0})
            self.assertEqual(october["closing"], {"digital": 149156, "cash": 0})
            income = category_overview(db, 1, "income", "2026-10")
            self.assertEqual(income["carryover"], 149156)
            self.assertEqual(income["total"], 149156)
        create_transaction(TransactionInput(
            occurred_on=date(2026, 10, 1), kind="expense", account="digital",
            category="ALMUERZOS - CENA", expense_class="variable", amount=1000,
        ), 1)
        with connection() as db:
            variable = category_overview(db, 1, "variable", "2026-10")
            self.assertEqual(variable["total"], 1000)
            self.assertGreaterEqual(len(variable["rows"]), 15)
            self.assertTrue(any(item["amount"] == 0 for item in variable["rows"]))

    def test_edit_zero_income_concept_and_its_value_without_changing_import(self):
        import_month(1, read_september(DEFAULT_SOURCE))
        with connection() as db:
            imported = concept_details(db, 1, "income", "2026-09", "PADRE ARRIENDO")
            self.assertFalse(imported["editable"])
            carry = concept_details(db, 1, "income", "2026-10", "Disponible trasladado")
            self.assertFalse(carry["editable"])
            self.assertTrue(carry["calculated"])
            before = concept_details(db, 1, "income", "2026-10", "PADRE ARRIENDO")
            self.assertEqual(before["amount"], 0)
            rename_concept(db, 1, "income", "2026-10", "PADRE ARRIENDO", "Arriendo familiar")
        self.assertIn("Arriendo familiar", categories(1)["income"])
        self.assertNotIn("PADRE ARRIENDO", categories(1)["income"])
        movement = create_transaction(TransactionInput(
            occurred_on=date(2026, 10, 2), kind="income", account="digital",
            category="Arriendo familiar", amount=10000,
        ), 1)
        with connection() as db:
            change_entry_amount(db, 1, "transaction", movement["id"], 12000)
            updated = concept_details(db, 1, "income", "2026-10", "Arriendo familiar")
            self.assertEqual(updated["entries"][0]["amount"], 12000)
            self.assertEqual(category_overview(db, 1, "income", "2026-10")["total"], 161156)
            hide_concept(db, 1, "income", "2026-10", "Arriendo familiar")
        self.assertNotIn("Arriendo familiar", categories(1)["income"])
        self.assertEqual(summary(1)["total"], 149156)
        with connection() as db:
            self.assertEqual(category_overview(db, 1, "income", "2026-09")["total"], 2104000)

    def test_concept_editor_keeps_multiple_entries_separate(self):
        import_month(1, read_september(DEFAULT_SOURCE))
        first = create_transaction(TransactionInput(
            occurred_on=date(2026, 10, 2), kind="income", account="digital",
            category="Otros ingresos", amount=1000,
        ), 1)
        second = create_transaction(TransactionInput(
            occurred_on=date(2026, 10, 3), kind="income", account="cash",
            category="Otros ingresos", amount=2000,
        ), 1)
        with connection() as db:
            details = concept_details(db, 1, "income", "2026-10", "Otros ingresos")
            self.assertEqual((details["amount"], len(details["entries"])), (3000, 2))
            change_entry_amount(db, 1, "transaction", first["id"], 1500)
            change_entry_amount(db, 1, "transaction", second["id"], None)
        self.assertEqual(summary(1)["digital"], 150656)
        self.assertEqual(summary(1)["cash"], 0)
        with connection() as db:
            self.assertEqual(concept_details(db, 1, "income", "2026-10", "Otros ingresos")["amount"], 1500)
            with self.assertRaises(ValueError):
                rename_concept(db, 1, "income", "2026-10", "Otros ingresos", "PADRE ARRIENDO")

    def test_new_categories_are_saved_with_values_and_remain_available(self):
        import_month(1, read_september(DEFAULT_SOURCE))
        created = create_transaction(TransactionInput(
            occurred_on=date(2026, 10, 1), kind="income", account="digital",
            category="Venta de libros", amount=30000, create_category=True,
        ), 1)
        self.assertIn("Venta de libros", categories(1)["income"])
        self.assertNotIn("Venta de libros", categories(1)["variable"])
        with self.assertRaises(HTTPException) as error:
            create_transaction(TransactionInput(
                occurred_on=date(2026, 10, 2), kind="income", account="digital",
                category="Venta de libros", amount=1000, create_category=True,
            ), 1)
        self.assertEqual(error.exception.status_code, 422)
        create_transaction(TransactionInput(
            occurred_on=date(2026, 10, 2), kind="expense", account="cash",
            category="Venta de libros", expense_class="variable", amount=2000, create_category=True,
        ), 1)
        fixed = create_transaction(TransactionInput(
            occurred_on=date(2026, 10, 2), kind="expense", account="digital",
            category="Nuevo servicio", expense_class="fixed", amount=5000, create_category=True,
        ), 1)
        self.assertIn("Venta de libros", categories(1)["variable"])
        self.assertIn("Nuevo servicio", categories(1)["fixed"])
        with connection() as db:
            change_entry_amount(db, 1, "transaction", created["id"], None)
            self.assertEqual(concept_details(db, 1, "income", "2026-10", "Venta de libros")["amount"], 0)
            rename_concept(db, 1, "income", "2026-10", "Venta de libros", "Libros usados")
        self.assertIn("Libros usados", categories(1)["income"])
        self.assertNotIn("Venta de libros", categories(1)["income"])
        with connection() as db:
            hide_concept(db, 1, "income", "2026-10", "Libros usados")
            change_entry_amount(db, 1, "transaction", fixed["id"], None)
            self.assertTrue(any(item["label"] == "Nuevo servicio" for item in fixed_schedule(db, 1, date(2026, 10, 3))))
        self.assertNotIn("Libros usados", categories(1)["income"])
        with connection() as db:
            db.execute("INSERT INTO users(email, password_hash) VALUES (?, ?)", ("other@example.com", "test"))
        self.assertNotIn("Nuevo servicio", categories(2)["fixed"])

    def test_debt_payments_change_cash_and_remaining_balance(self):
        import_month(1, read_september(DEFAULT_SOURCE))
        before = get_dashboard_data("2026-10", 1)
        self.assertEqual(before["closing"], {"digital": 149156, "cash": 0})
        payable = create_debt_payment(DebtPaymentInput(
            occurred_on=date(2026, 10, 2), direction="payable", concept="LLANTAS MTB",
            account="digital", amount=20000,
        ), 1)
        receivable = create_debt_payment(DebtPaymentInput(
            occurred_on=date(2026, 10, 3), direction="receivable", concept="Sebastian",
            account="cash", amount=30000,
        ), 1)
        before_cobro = get_debt_balances(date(2026, 10, 2), 1)["receivable"]["Sebastian"]
        after_cobro = get_debt_balances(date(2026, 10, 3), 1)["receivable"]["Sebastian"]
        self.assertEqual(before_cobro - after_cobro, 30000)
        with connection() as db:
            payable_view = category_overview(db, 1, "payable", "2026-10")
            receivable_view = category_overview(db, 1, "receivable", "2026-10")
            income_view = category_overview(db, 1, "income", "2026-10")
            self.assertEqual(
                next(row["amount"] for row in payable_view["rows"] if row["label"] == "LLANTAS MTB"),
                next(row["balance"] for row in db.execute(
                    "SELECT label, balance FROM historical_debts WHERE label = 'LLANTAS MTB'"
                )) - 20000,
            )
            self.assertEqual(
                next(row["amount"] for row in receivable_view["rows"] if row["label"] == "Sebastian"),
                next(row["balance"] for row in db.execute(
                    "SELECT label, balance FROM historical_debts WHERE label = 'Sebastian'"
                )) - 30000,
            )
            self.assertEqual(next(row["amount"] for row in income_view["rows"] if row["label"] == "Sebastian"), 30000)
        october = get_dashboard_data("2026-10", 1)
        self.assertEqual(october["closing"], {"digital": 129156, "cash": 30000})
        self.assertEqual(october["income"], {"digital": 0, "cash": 30000})
        self.assertEqual(october["debt_payments"], 20000)
        self.assertEqual(summary(1)["total"], 159156)
        self.assertEqual(latest_entry(1)["entry_type"], "payment")
        delete_latest_entry(LatestEntryInput(entry_type="payment", id=receivable["id"]), 1)
        self.assertEqual(summary(1)["total"], 129156)
        delete_latest_entry(LatestEntryInput(entry_type="payment", id=payable["id"]), 1)
        self.assertEqual(summary(1)["total"], 149156)

    def test_payable_and_receivable_balances_carry_to_following_months(self):
        import_month(1, read_september(DEFAULT_SOURCE))
        create_debt(DebtInput(
            occurred_on=date(2026, 10, 2), direction="payable", concept="Deuda nueva en contra", amount=100000,
        ), 1)
        create_debt(DebtInput(
            occurred_on=date(2026, 10, 2), direction="receivable", concept="Deuda nueva a favor", amount=80000,
        ), 1)
        create_debt_payment(DebtPaymentInput(
            occurred_on=date(2026, 10, 5), direction="payable", concept="Deuda nueva en contra",
            account="digital", amount=20000,
        ), 1)
        create_debt_payment(DebtPaymentInput(
            occurred_on=date(2026, 10, 5), direction="receivable", concept="Deuda nueva a favor",
            account="cash", amount=15000,
        ), 1)
        with connection() as db:
            imported = {row["label"]: row["balance"] for row in db.execute(
                "SELECT label, balance FROM historical_debts WHERE month_id = "
                "(SELECT id FROM historical_months WHERE user_id = ? AND period = ?)", (1, "2026-09"),
            )}
            for period in ("2026-10", "2026-11"):
                payable = {row["label"]: row["amount"] for row in category_overview(db, 1, "payable", period)["rows"]}
                receivable = {row["label"]: row["amount"] for row in category_overview(db, 1, "receivable", period)["rows"]}
                self.assertEqual(payable["Deuda nueva en contra"], 80000)
                self.assertEqual(receivable["Deuda nueva a favor"], 65000)
                self.assertEqual(payable["LLANTAS MTB"], imported["LLANTAS MTB"])
                self.assertEqual(receivable["Sebastian"], imported["Sebastian"])
            november_before = dashboard_data(db, 1, "2026-11")["debts"]
        create_debt_payment(DebtPaymentInput(
            occurred_on=date(2026, 11, 5), direction="payable", concept="Deuda nueva en contra",
            account="digital", amount=10000,
        ), 1)
        create_debt_payment(DebtPaymentInput(
            occurred_on=date(2026, 11, 5), direction="receivable", concept="Deuda nueva a favor",
            account="cash", amount=5000,
        ), 1)
        with connection() as db:
            november = dashboard_data(db, 1, "2026-11")["debts"]
            december = dashboard_data(db, 1, "2026-12")["debts"]
            self.assertEqual(november, december)
            self.assertEqual(november_before["payable"] - november["payable"], 10000)
            self.assertEqual(november_before["receivable"] - november["receivable"], 5000)
            self.assertEqual(next(row["amount"] for row in category_overview(db, 1, "payable", "2026-12")["rows"] if row["label"] == "Deuda nueva en contra"), 70000)
            self.assertEqual(next(row["amount"] for row in category_overview(db, 1, "receivable", "2026-12")["rows"] if row["label"] == "Deuda nueva a favor"), 60000)

    def test_delete_any_recent_entry_updates_balance_and_debt(self):
        import_month(1, read_september(DEFAULT_SOURCE))
        income = create_transaction(TransactionInput(
            occurred_on=date(2026, 10, 1), kind="income", account="digital",
            category="PADRE ARRIENDO", amount=50000,
        ), 1)
        expense = create_transaction(TransactionInput(
            occurred_on=date(2026, 10, 2), kind="expense", account="digital",
            category="ALMUERZOS - CENA", expense_class="variable", amount=10000,
        ), 1)
        self.assertEqual(summary(1)["total"], 189156)
        delete_concept_entry("transaction", expense["id"], 1)
        self.assertEqual(summary(1)["total"], 199156)
        delete_concept_entry("transaction", income["id"], 1)
        self.assertEqual(summary(1)["total"], 149156)

        debt = create_debt(DebtInput(
            occurred_on=date(2026, 10, 3), direction="payable", concept="Préstamo nuevo", amount=30000,
        ), 1)
        payment = create_debt_payment(DebtPaymentInput(
            occurred_on=date(2026, 10, 4), direction="payable", concept="Préstamo nuevo",
            account="digital", amount=10000,
        ), 1)
        with self.assertRaises(HTTPException) as error:
            delete_concept_entry("debt", debt["id"], 1)
        self.assertEqual(error.exception.status_code, 422)
        self.assertEqual(summary(1)["total"], 139156)
        delete_concept_entry("payment", payment["id"], 1)
        self.assertEqual(summary(1)["total"], 149156)
        delete_concept_entry("debt", debt["id"], 1)
        with connection() as db:
            self.assertNotIn("Préstamo nuevo", {row["label"] for row in category_overview(db, 1, "payable", "2026-10")["rows"] if row["amount"] > 0})

    def test_debt_payment_cannot_exceed_outstanding_balance(self):
        import_month(1, read_september(DEFAULT_SOURCE))
        with connection() as db:
            amount = next(row["balance"] for row in db.execute(
                "SELECT balance FROM historical_debts WHERE label = 'LLANTAS MTB'"
            ))
        with self.assertRaises(HTTPException) as error:
            create_debt_payment(DebtPaymentInput(
                occurred_on=date(2026, 10, 2), direction="payable", concept="LLANTAS MTB",
                account="digital", amount=amount + 1,
            ), 1)
        self.assertEqual(error.exception.status_code, 422)
        self.assertEqual(summary(1)["total"], 149156)
        payment = create_debt_payment(DebtPaymentInput(
            occurred_on=date(2026, 10, 2), direction="payable", concept="LLANTAS MTB",
            account="digital", amount=1000,
        ), 1)
        with self.assertRaises(ValueError):
            with connection() as db:
                change_entry_amount(db, 1, "payment", payment["id"], amount + 1)
        self.assertEqual(summary(1)["total"], 148156)
        with connection() as db:
            self.assertEqual(concept_details(db, 1, "payable", "2026-10", "LLANTAS MTB")["entries"][0]["amount"], 1000)
            november = dashboard_data(db, 1, today_period="2026-11")
            self.assertEqual(november["opening"], {"digital": 148156, "cash": 0})

    def test_earlier_payment_cannot_overdraw_a_later_one(self):
        import_month(1, read_september(DEFAULT_SOURCE))
        with connection() as db:
            amount = next(row["balance"] for row in db.execute(
                "SELECT balance FROM historical_debts WHERE label = 'LLANTAS MTB'"
            ))
        create_debt_payment(DebtPaymentInput(
            occurred_on=date(2026, 11, 2), direction="payable", concept="LLANTAS MTB",
            account="digital", amount=amount - 1000,
        ), 1)
        with self.assertRaises(HTTPException) as error:
            create_debt_payment(DebtPaymentInput(
                occurred_on=date(2026, 10, 2), direction="payable", concept="LLANTAS MTB",
                account="digital", amount=2000,
            ), 1)
        self.assertEqual(error.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
