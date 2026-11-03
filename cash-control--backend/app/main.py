import hashlib
import hmac
import os
import secrets
import sqlite3
import calendar
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field

from .db import connection, init_db
from .dashboard_data import dashboard_data as build_dashboard_data
from .category_views import category_overview, category_preferences, fixed_schedule, is_hidden, visible_label
from .category_editor import concept_details, rename_concept, hide_concept, change_entry_amount, set_fixed_plan
from .debt_ledger import debt_balances, validate_debt_ledger


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Cash Control API", lifespan=lifespan)
SESSION_DAYS = 7


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=12, max_length=256)


class TransactionInput(BaseModel):
    occurred_on: date
    kind: Literal["income", "expense", "transfer"]
    account: Literal["digital", "cash"]
    target_account: Literal["digital", "cash"] | None = None
    category: str = Field(min_length=1, max_length=80)
    expense_class: Literal["fixed", "variable"] | None = None
    description: str = Field(default="", max_length=300)
    amount: int = Field(gt=0)
    create_category: bool = False


class DebtInput(BaseModel):
    occurred_on: date
    direction: Literal["payable", "receivable"]
    concept: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=300)
    amount: int = Field(gt=0)


class DebtPaymentInput(BaseModel):
    occurred_on: date
    direction: Literal["payable", "receivable"]
    concept: str = Field(min_length=1, max_length=80)
    account: Literal["digital", "cash"]
    description: str = Field(default="", max_length=300)
    amount: int = Field(gt=0)


class LatestEntryInput(BaseModel):
    entry_type: Literal["transaction", "debt", "payment"]
    id: int = Field(gt=0)


class DueDayInput(BaseModel):
    due_day: int = Field(ge=1, le=31)


class ConceptNameInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class EntryAmountInput(BaseModel):
    amount: int = Field(gt=0)


class FixedPlanInput(BaseModel):
    amount: int = Field(ge=0)


class FixedPaymentInput(BaseModel):
    period: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    occurred_on: date
    category: str = Field(min_length=1, max_length=80)
    account: Literal["digital", "cash"]


def password_hash(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 600_000)
    return f"{salt.hex()}:{digest.hex()}"


def password_valid(password: str, encoded: str) -> bool:
    try:
        salt_hex, expected_hex = encoded.split(":", 1)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), 600_000)
        return hmac.compare_digest(actual, bytes.fromhex(expected_hex))
    except (ValueError, TypeError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def current_user(authorization: str | None = Header(default=None)) -> int:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Sesión requerida")
    token = authorization.removeprefix("Bearer ")
    now = datetime.now(timezone.utc).isoformat()
    with connection() as db:
        row = db.execute(
            "SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?",
            (token_hash(token), now),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=401, detail="Sesión vencida")
    return row["user_id"]


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/auth/setup-status")
def setup_status():
    with connection() as db:
        has_users = db.execute("SELECT EXISTS(SELECT 1 FROM users)").fetchone()[0]
    return {"needs_setup": not bool(has_users)}


@app.post("/auth/setup", status_code=status.HTTP_201_CREATED)
def setup(body: Credentials):
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=422, detail="Correo inválido")
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT EXISTS(SELECT 1 FROM users)").fetchone()[0]:
            raise HTTPException(status_code=409, detail="El usuario inicial ya existe")
        db.execute(
            "INSERT INTO users(email, password_hash) VALUES (?, ?)",
            (email, password_hash(body.password)),
        )
    return {"created": True}


@app.post("/auth/login")
def login(body: Credentials):
    with connection() as db:
        row = db.execute(
            "SELECT id, password_hash FROM users WHERE email = ?",
            (body.email.strip().lower(),),
        ).fetchone()
        if row is None or not password_valid(body.password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Credenciales incorrectas")
        token = secrets.token_urlsafe(32)
        expiry = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
        db.execute(
            "INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            (token_hash(token), row["id"], expiry.isoformat()),
        )
    return {"access_token": token, "token_type": "bearer", "expires_in": SESSION_DAYS * 86400}


@app.post("/auth/logout")
def logout(authorization: str | None = Header(default=None), user_id: int = Depends(current_user)):
    token = authorization.removeprefix("Bearer ")
    with connection() as db:
        db.execute("DELETE FROM sessions WHERE token_hash = ? AND user_id = ?", (token_hash(token), user_id))
    return {"ok": True}


@app.get("/auth/me")
def me(user_id: int = Depends(current_user)):
    with connection() as db:
        row = db.execute("SELECT id, email FROM users WHERE id = ?", (user_id,)).fetchone()
    return dict(row)


@app.get("/transactions")
def transactions(user_id: int = Depends(current_user)):
    with connection() as db:
        rows = db.execute(
            "SELECT id, occurred_on, kind, account, target_account, category, expense_class, description, amount "
            "FROM transactions WHERE user_id = ? ORDER BY occurred_on DESC, id DESC LIMIT 200",
            (user_id,),
        ).fetchall()
    return [dict(row) for row in rows]


@app.post("/transactions", status_code=status.HTTP_201_CREATED)
def create_transaction(body: TransactionInput, user_id: int = Depends(current_user)):
    if (body.kind == "transfer") != (body.target_account is not None):
        raise HTTPException(status_code=422, detail="La cuenta destino es obligatoria solo para transferencias")
    if body.kind == "transfer" and body.account == body.target_account:
        raise HTTPException(status_code=422, detail="Las cuentas deben ser diferentes")
    category = body.category.strip()
    if not category:
        raise HTTPException(status_code=422, detail="Selecciona una categoría")
    expense_class = body.expense_class or "variable" if body.kind == "expense" else None
    with connection() as db:
        _require_unimported_date(db, user_id, body.occurred_on)
        if body.kind != "transfer":
            category_kind = "income" if body.kind == "income" else expense_class
            allowed = _categories(db, user_id)[category_kind]
            exists = category.casefold() in {name.casefold() for name in allowed}
            if body.create_category and exists:
                raise HTTPException(status_code=422, detail="La categoría ya existe; selecciónala en la lista")
            if body.create_category:
                _register_category(db, user_id, category_kind, category)
            elif not exists:
                raise HTTPException(status_code=422, detail="Selecciona una categoría de este tipo")
        elif body.create_category:
            raise HTTPException(status_code=422, detail="Las transferencias no tienen categoría nueva")
        cursor = db.execute(
            "INSERT INTO transactions(user_id, occurred_on, kind, account, target_account, category, expense_class, description, amount) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, body.occurred_on.isoformat(), body.kind, body.account,
             body.target_account, category, expense_class, body.description.strip(), body.amount),
        )
        db.execute("UPDATE transactions SET created_at = ? WHERE id = ?", (
            datetime.now(timezone.utc).isoformat(timespec="microseconds"), cursor.lastrowid))
        return {"id": cursor.lastrowid}


def _require_unimported_date(db: sqlite3.Connection, user_id: int, occurred_on: date):
    latest = db.execute(
        "SELECT period FROM historical_months WHERE user_id = ? ORDER BY period DESC LIMIT 1", (user_id,)
    ).fetchone()
    if latest and occurred_on.isoformat() <= _period_end(latest["period"]):
        raise HTTPException(status_code=422, detail="La fecha pertenece a un mes ya importado")


def _categories(db: sqlite3.Connection, user_id: int) -> dict[str, list[str]]:
    result = {
        "income": {"Otros ingresos"}, "fixed": {"Otros gastos fijos"},
        "variable": {"Varios"}, "payable": set(), "receivable": set(),
    }
    sources = (
        ("income", "SELECT i.label FROM historical_income i JOIN historical_months m ON m.id = i.month_id WHERE m.user_id = ?"),
        ("fixed", "SELECT i.label FROM historical_fixed_expenses i JOIN historical_months m ON m.id = i.month_id WHERE m.user_id = ?"),
        ("variable", "SELECT i.label FROM historical_variable_expenses i JOIN historical_months m ON m.id = i.month_id WHERE m.user_id = ?"),
        ("payable", "SELECT i.label FROM historical_debts i JOIN historical_months m ON m.id = i.month_id WHERE m.user_id = ? AND i.direction = 'payable'"),
        ("receivable", "SELECT i.label FROM historical_debts i JOIN historical_months m ON m.id = i.month_id WHERE m.user_id = ? AND i.direction = 'receivable'"),
        ("income", "SELECT category FROM transactions WHERE user_id = ? AND kind = 'income'"),
        ("fixed", "SELECT category FROM transactions WHERE user_id = ? AND kind = 'expense' AND expense_class = 'fixed'"),
        ("variable", "SELECT category FROM transactions WHERE user_id = ? AND kind = 'expense' AND (expense_class = 'variable' OR expense_class IS NULL)"),
        ("payable", "SELECT concept FROM debts WHERE user_id = ? AND direction = 'payable'"),
        ("receivable", "SELECT concept FROM debts WHERE user_id = ? AND direction = 'receivable'"),
    )
    for kind, query in sources:
        result[kind].update(row[0] for row in db.execute(query, (user_id,)) if row[0])
    for row in db.execute("SELECT kind, name FROM user_categories WHERE user_id = ?", (user_id,)):
        result[row["kind"]].add(row["name"])
    visible = {}
    for kind, names in result.items():
        preferences = category_preferences(db, user_id, kind)
        visible[kind] = sorted(
            {visible_label(name, preferences) for name in names if not is_hidden(name, preferences)},
            key=str.casefold,
        )
    return visible


def _register_category(db: sqlite3.Connection, user_id: int, kind: str, name: str):
    name = name.strip()
    if not name or len(name) > 80:
        raise HTTPException(status_code=422, detail="Escribe una categoría de hasta 80 caracteres")
    if name.casefold() == "disponible trasladado":
        raise HTTPException(status_code=422, detail="Ese nombre está reservado para el saldo automático")
    hidden = db.execute(
        "SELECT original_label FROM category_preferences WHERE user_id = ? AND kind = ? "
        "AND hidden = 1 AND (display_label = ? COLLATE NOCASE OR original_label = ? COLLATE NOCASE)",
        (user_id, kind, name, name),
    ).fetchone()
    if hidden:
        db.execute(
            "UPDATE category_preferences SET display_label = ?, hidden = 0 "
            "WHERE user_id = ? AND kind = ? AND original_label = ?",
            (name, user_id, kind, hidden["original_label"]),
        )
    else:
        try:
            db.execute("INSERT INTO user_categories(user_id, kind, name) VALUES (?, ?, ?)",
                       (user_id, kind, name))
        except sqlite3.IntegrityError as error:
            raise HTTPException(status_code=422, detail="La categoría ya existe") from error


@app.get("/categories")
def categories(user_id: int = Depends(current_user)):
    with connection() as db:
        return _categories(db, user_id)


@app.get("/dashboard-data")
def get_dashboard_data(period: str | None = None, user_id: int = Depends(current_user)):
    with connection() as db:
        try:
            return build_dashboard_data(db, user_id, period)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/fixed-schedule")
def get_fixed_schedule(period: str | None = None, user_id: int = Depends(current_user)):
    with connection() as db:
        try:
            return fixed_schedule(db, user_id, period=period)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/fixed-payments", status_code=status.HTTP_201_CREATED)
def confirm_fixed_payment(body: FixedPaymentInput, user_id: int = Depends(current_user)):
    if body.occurred_on.strftime("%Y-%m") != body.period:
        raise HTTPException(status_code=422, detail="La fecha debe pertenecer al período seleccionado")
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        payment = next((item for item in fixed_schedule(db, user_id, body.occurred_on, body.period)
                        if item["label"].casefold() == body.category.strip().casefold()), None)
        if payment is None:
            raise HTTPException(status_code=404, detail="Gasto fijo no encontrado")
        if payment["paid"] > 0:
            raise HTTPException(status_code=409, detail="Este gasto fijo ya tiene un pago registrado en el mes")
        if payment["planned"] <= 0:
            raise HTTPException(status_code=422, detail="Configura primero un valor previsto mayor que cero")
        cursor = db.execute(
            "INSERT INTO transactions(user_id, occurred_on, kind, account, target_account, category, expense_class, description, amount, created_at) "
            "VALUES (?, ?, 'expense', ?, NULL, ?, 'fixed', ?, ?, ?)",
            (user_id, body.occurred_on.isoformat(), body.account, payment["label"],
             "Pago fijo confirmado desde Dashboard", payment["planned"],
             datetime.now(timezone.utc).isoformat(timespec="microseconds")),
        )
        return {"id": cursor.lastrowid, "amount": payment["planned"]}


@app.put("/fixed-schedule/{category}")
def set_fixed_due_day(category: str, body: DueDayInput, user_id: int = Depends(current_user)):
    with connection() as db:
        if category.casefold() not in {name.casefold() for name in _categories(db, user_id)["fixed"]}:
            raise HTTPException(status_code=404, detail="Categoría de gasto fijo no encontrada")
        db.execute(
            "INSERT INTO fixed_due_days(user_id, category, due_day) VALUES (?, ?, ?) "
            "ON CONFLICT(user_id, category) DO UPDATE SET due_day = excluded.due_day",
            (user_id, category, body.due_day),
        )
    return {"ok": True}


@app.get("/category-overview/{kind}")
def get_category_overview(kind: str, period: str, user_id: int = Depends(current_user)):
    with connection() as db:
        try:
            return category_overview(db, user_id, kind, period)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/debt-balances")
def get_debt_balances(on: date, user_id: int = Depends(current_user)):
    with connection() as db:
        return {direction: {concept: amount for concept, amount in debt_balances(
            db, user_id, direction, on.strftime("%Y-%m"), on.isoformat()
        ).items() if amount > 0} for direction in ("payable", "receivable")}


@app.get("/concepts/{kind}")
def get_concept(kind: str, label: str, period: str, user_id: int = Depends(current_user)):
    with connection() as db:
        try:
            return concept_details(db, user_id, kind, period, label)
        except LookupError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error


@app.put("/fixed-plans/{category}")
def update_fixed_plan(category: str, period: str, body: FixedPlanInput,
                      user_id: int = Depends(current_user)):
    with connection() as db:
        try:
            return set_fixed_plan(db, user_id, period, category, body.amount)
        except LookupError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error


@app.patch("/concepts/{kind}")
def edit_concept(kind: str, label: str, period: str, body: ConceptNameInput,
                 user_id: int = Depends(current_user)):
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            return rename_concept(db, user_id, kind, period, label, body.name)
        except LookupError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except (ValueError, sqlite3.IntegrityError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error


@app.delete("/concepts/{kind}")
def delete_concept(kind: str, label: str, period: str, user_id: int = Depends(current_user)):
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            return hide_concept(db, user_id, kind, period, label)
        except LookupError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error


@app.patch("/concept-entries/{entry_type}/{entry_id}")
def edit_concept_entry(entry_type: str, entry_id: int, body: EntryAmountInput,
                       user_id: int = Depends(current_user)):
    with connection() as db:
        try:
            return change_entry_amount(db, user_id, entry_type, entry_id, body.amount)
        except LookupError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error


@app.delete("/concept-entries/{entry_type}/{entry_id}")
def delete_concept_entry(entry_type: str, entry_id: int, user_id: int = Depends(current_user)):
    with connection() as db:
        try:
            return change_entry_amount(db, user_id, entry_type, entry_id, None)
        except LookupError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/debts")
def debts(user_id: int = Depends(current_user)):
    with connection() as db:
        rows = db.execute(
            "SELECT id, occurred_on, direction, concept, description, amount "
            "FROM debts WHERE user_id = ? ORDER BY occurred_on DESC, id DESC LIMIT 100", (user_id,)
        ).fetchall()
    return [dict(row) for row in rows]


@app.get("/debt-payments")
def debt_payments(user_id: int = Depends(current_user)):
    with connection() as db:
        rows = db.execute(
            "SELECT id, occurred_on, direction, concept, account, description, amount "
            "FROM debt_payments WHERE user_id = ? ORDER BY occurred_on DESC, id DESC LIMIT 100",
            (user_id,),
        ).fetchall()
    return [dict(row) for row in rows]


@app.post("/debts", status_code=status.HTTP_201_CREATED)
def create_debt(body: DebtInput, user_id: int = Depends(current_user)):
    concept = body.concept.strip()
    if not concept:
        raise HTTPException(status_code=422, detail="Escribe un concepto para la deuda")
    with connection() as db:
        _require_unimported_date(db, user_id, body.occurred_on)
        if concept.casefold() not in {name.casefold() for name in _categories(db, user_id)[body.direction]}:
            _register_category(db, user_id, body.direction, concept)
        cursor = db.execute(
            "INSERT INTO debts(user_id, occurred_on, direction, concept, description, amount) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, body.occurred_on.isoformat(), body.direction, concept,
             body.description.strip(), body.amount),
        )
        db.execute("UPDATE debts SET created_at = ? WHERE id = ?", (
            datetime.now(timezone.utc).isoformat(timespec="microseconds"), cursor.lastrowid))
    return {"id": cursor.lastrowid}


@app.post("/debt-payments", status_code=status.HTTP_201_CREATED)
def create_debt_payment(body: DebtPaymentInput, user_id: int = Depends(current_user)):
    concept = body.concept.strip()
    if not concept:
        raise HTTPException(status_code=422, detail="Selecciona una deuda")
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        _require_unimported_date(db, user_id, body.occurred_on)
        if concept.casefold() not in {item.casefold() for item in _categories(db, user_id)[body.direction]}:
            raise HTTPException(status_code=422, detail="Selecciona un concepto de deuda existente")
        cursor = db.execute(
            "INSERT INTO debt_payments(user_id, occurred_on, direction, concept, account, description, amount, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, body.occurred_on.isoformat(), body.direction, concept, body.account,
             body.description.strip(), body.amount, datetime.now(timezone.utc).isoformat(timespec="microseconds")),
        )
        try:
            validate_debt_ledger(db, user_id, body.direction, concept)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
    return {"id": cursor.lastrowid}


def _latest_entry(db: sqlite3.Connection, user_id: int) -> dict | None:
    row = db.execute(
        "SELECT entry_type, id, occurred_on, label, amount FROM ("
        "SELECT 'transaction' AS entry_type, id, occurred_on, category AS label, amount, created_at "
        "FROM transactions WHERE user_id = ? UNION ALL "
        "SELECT 'debt' AS entry_type, id, occurred_on, concept AS label, amount, created_at "
        "FROM debts WHERE user_id = ? UNION ALL "
        "SELECT 'payment' AS entry_type, id, occurred_on, concept AS label, amount, created_at "
        "FROM debt_payments WHERE user_id = ?) "
        "ORDER BY created_at DESC, id DESC, entry_type DESC LIMIT 1", (user_id, user_id, user_id)
    ).fetchone()
    return dict(row) if row else None


@app.get("/entries/latest")
def latest_entry(user_id: int = Depends(current_user)):
    with connection() as db:
        return _latest_entry(db, user_id)


@app.delete("/entries/latest")
def delete_latest_entry(body: LatestEntryInput, user_id: int = Depends(current_user)):
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        latest = _latest_entry(db, user_id)
        if latest is None:
            raise HTTPException(status_code=404, detail="No hay registros recientes para eliminar")
        if latest["entry_type"] != body.entry_type or latest["id"] != body.id:
            raise HTTPException(status_code=409, detail="El último registro cambió. Actualiza y vuelve a intentarlo")
        table = {"transaction": "transactions", "debt": "debts", "payment": "debt_payments"}[body.entry_type]
        debt_row = db.execute("SELECT direction, concept FROM debts WHERE id = ? AND user_id = ?", (body.id, user_id)).fetchone() if body.entry_type == "debt" else None
        db.execute(f"DELETE FROM {table} WHERE id = ? AND user_id = ?", (body.id, user_id))
        if debt_row:
            try:
                validate_debt_ledger(db, user_id, debt_row["direction"], debt_row["concept"])
            except ValueError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error
    return {"ok": True, "deleted": latest}


@app.delete("/transactions/{transaction_id}")
def delete_transaction(transaction_id: int, user_id: int = Depends(current_user)):
    with connection() as db:
        result = db.execute("DELETE FROM transactions WHERE id = ? AND user_id = ?", (transaction_id, user_id))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Movimiento no encontrado")
    return {"ok": True}


@app.get("/summary")
def summary(user_id: int = Depends(current_user)):
    with connection() as db:
        latest = db.execute(
            "SELECT period, closing_digital, closing_cash FROM historical_months "
            "WHERE user_id = ? ORDER BY period DESC LIMIT 1", (user_id,)
        ).fetchone()
        cutoff = f"{latest['period']}-00" if latest else "0000-00-00"
        rows = db.execute(
            "SELECT kind, account, target_account, amount FROM transactions "
            "WHERE user_id = ? AND occurred_on > ?", (user_id, cutoff)
        ).fetchall()
        payments = db.execute(
            "SELECT direction, account, amount FROM debt_payments WHERE user_id = ? AND occurred_on > ?",
            (user_id, cutoff),
        ).fetchall()
    balance = {"digital": latest["closing_digital"] if latest else 0,
               "cash": latest["closing_cash"] if latest else 0}
    income = expense = 0
    for row in rows:
        amount = row["amount"]
        if row["kind"] == "income":
            balance[row["account"]] += amount
            income += amount
        elif row["kind"] == "expense":
            balance[row["account"]] -= amount
            expense += amount
        else:
            balance[row["account"]] -= amount
            balance[row["target_account"]] += amount
    for row in payments:
        if row["direction"] == "receivable":
            balance[row["account"]] += row["amount"]
            income += row["amount"]
        else:
            balance[row["account"]] -= row["amount"]
            expense += row["amount"]
    return {"digital": balance["digital"], "cash": balance["cash"],
            "total": sum(balance.values()), "income": income, "expense": expense,
            "baseline_period": latest["period"] if latest else None}


def _period_end(period: str) -> str:
    year, month = map(int, period.split("-"))
    return f"{year:04d}-{month:02d}-{calendar.monthrange(year, month)[1]:02d}"


@app.get("/history/months/{period}")
def historical_month(period: str, user_id: int = Depends(current_user)):
    with connection() as db:
        month = db.execute(
            "SELECT period, opening_digital, opening_cash, transfer_cash_to_digital, "
            "closing_digital, closing_cash, source_file, imported_at "
            "FROM historical_months WHERE user_id = ? AND period = ?",
            (user_id, period),
        ).fetchone()
        if month is None:
            raise HTTPException(status_code=404, detail="Mes no importado")
        month_id = db.execute(
            "SELECT id FROM historical_months WHERE user_id = ? AND period = ?", (user_id, period)
        ).fetchone()["id"]
        result = dict(month)
        for key, table in (
            ("income", "historical_income"), ("fixed_expenses", "historical_fixed_expenses"),
            ("variable_expenses", "historical_variable_expenses"), ("debts", "historical_debts"),
        ):
            result[key] = [dict(row) for row in db.execute(
                f"SELECT * FROM {table} WHERE month_id = ? ORDER BY source_row", (month_id,)
            ).fetchall()]
    return result
