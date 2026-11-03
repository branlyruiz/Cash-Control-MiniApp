import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path


def database_path() -> Path:
    return Path(os.getenv("CASH_CONTROL_DB", "./data/cash-control.sqlite3")).resolve()


@contextmanager
def connection():
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init_db():
    with connection() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            occurred_on TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'transfer')),
            account TEXT NOT NULL CHECK (account IN ('digital', 'cash')),
            target_account TEXT CHECK (target_account IN ('digital', 'cash')),
            category TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            amount INTEGER NOT NULL CHECK (amount > 0),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CHECK ((kind = 'transfer' AND target_account IS NOT NULL AND target_account != account)
                OR (kind != 'transfer' AND target_account IS NULL))
        );
        CREATE INDEX IF NOT EXISTS idx_transactions_user_date
            ON transactions(user_id, occurred_on DESC, id DESC);
        CREATE TABLE IF NOT EXISTS historical_months (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            period TEXT NOT NULL,
            opening_digital INTEGER NOT NULL,
            opening_cash INTEGER NOT NULL,
            transfer_cash_to_digital INTEGER NOT NULL,
            closing_digital INTEGER NOT NULL,
            closing_cash INTEGER NOT NULL,
            source_file TEXT NOT NULL,
            source_sha256 TEXT NOT NULL,
            imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, period)
        );
        CREATE TABLE IF NOT EXISTS historical_income (
            id INTEGER PRIMARY KEY,
            month_id INTEGER NOT NULL REFERENCES historical_months(id) ON DELETE CASCADE,
            label TEXT NOT NULL,
            digital INTEGER NOT NULL,
            cash INTEGER NOT NULL,
            source_row INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS historical_fixed_expenses (
            id INTEGER PRIMARY KEY,
            month_id INTEGER NOT NULL REFERENCES historical_months(id) ON DELETE CASCADE,
            label TEXT NOT NULL,
            planned INTEGER NOT NULL,
            paid INTEGER NOT NULL,
            due_day INTEGER,
            source_row INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS historical_variable_expenses (
            id INTEGER PRIMARY KEY,
            month_id INTEGER NOT NULL REFERENCES historical_months(id) ON DELETE CASCADE,
            label TEXT NOT NULL,
            digital INTEGER NOT NULL,
            cash INTEGER NOT NULL,
            source_row INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS historical_debts (
            id INTEGER PRIMARY KEY,
            month_id INTEGER NOT NULL REFERENCES historical_months(id) ON DELETE CASCADE,
            direction TEXT NOT NULL CHECK (direction IN ('payable', 'receivable')),
            label TEXT NOT NULL,
            original INTEGER NOT NULL,
            paid INTEGER NOT NULL,
            balance INTEGER NOT NULL,
            source_row INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS debts (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            occurred_on TEXT NOT NULL,
            direction TEXT NOT NULL CHECK (direction IN ('payable', 'receivable')),
            concept TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            amount INTEGER NOT NULL CHECK (amount > 0),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_debts_user_date
            ON debts(user_id, occurred_on DESC, id DESC);
        CREATE TABLE IF NOT EXISTS fixed_due_days (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            category TEXT NOT NULL,
            due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
            PRIMARY KEY(user_id, category)
        );
        CREATE TABLE IF NOT EXISTS fixed_plans (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            effective_period TEXT NOT NULL,
            category TEXT NOT NULL,
            amount INTEGER NOT NULL CHECK (amount >= 0),
            PRIMARY KEY(user_id, effective_period, category)
        );
        CREATE TABLE IF NOT EXISTS category_preferences (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind TEXT NOT NULL CHECK (kind IN ('income', 'variable', 'fixed', 'payable', 'receivable')),
            original_label TEXT NOT NULL,
            display_label TEXT NOT NULL,
            hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
            PRIMARY KEY(user_id, kind, original_label)
        );
        CREATE TABLE IF NOT EXISTS user_categories (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind TEXT NOT NULL CHECK (kind IN ('income', 'variable', 'fixed', 'payable', 'receivable')),
            name TEXT NOT NULL COLLATE NOCASE,
            PRIMARY KEY(user_id, kind, name)
        );
        CREATE TABLE IF NOT EXISTS debt_payments (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            occurred_on TEXT NOT NULL,
            direction TEXT NOT NULL CHECK (direction IN ('payable', 'receivable')),
            concept TEXT NOT NULL,
            account TEXT NOT NULL CHECK (account IN ('digital', 'cash')),
            description TEXT NOT NULL DEFAULT '',
            amount INTEGER NOT NULL CHECK (amount > 0),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_debt_payments_user_date
            ON debt_payments(user_id, occurred_on DESC, id DESC);
        """)
        columns = {row["name"] for row in db.execute("PRAGMA table_info(transactions)")}
        if "expense_class" not in columns:
            db.execute("ALTER TABLE transactions ADD COLUMN expense_class TEXT "
                       "CHECK (expense_class IN ('fixed', 'variable'))")
