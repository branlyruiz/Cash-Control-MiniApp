export type EntryType = "income" | "variable" | "fixed" | "payable" | "payable_payment" | "receivable" | "receivable_new" | "transfer";
export type Account = "digital" | "cash";

export type Movement = {
  id: number;
  occurred_on: string;
  kind: "income" | "expense" | "transfer";
  account: Account;
  target_account: Account | null;
  category: string;
  expense_class: "fixed" | "variable" | null;
  description: string;
  amount: number;
};

export type Debt = {
  id: number;
  occurred_on: string;
  direction: "payable" | "receivable";
  concept: string;
  description: string;
  amount: number;
};

export type DebtPayment = {
  id: number;
  occurred_on: string;
  direction: "payable" | "receivable";
  concept: string;
  account: Account;
  description: string;
  amount: number;
};

export type Categories = {
  income: string[];
  fixed: string[];
  variable: string[];
  payable: string[];
  receivable: string[];
};

export type Summary = {
  digital: number;
  cash: number;
  total: number;
  income: number;
  expense: number;
  baseline_period: string | null;
};

export type DashboardData = {
  period: string;
  periods: string[];
  source: "excel" | "movements";
  opening: Record<Account, number>;
  closing: Record<Account, number>;
  income: Record<Account, number>;
  carryover: number;
  fixed: { planned: number | null; paid: number };
  variable: Record<Account, number>;
  debt_payments: number;
  debts: { payable: number; receivable: number };
  transfer_cash_to_digital: number;
  categories: { label: string; amount: number }[];
};

export type CategoryKind = "income" | "variable" | "fixed" | "receivable" | "payable";
export type CategoryOverview = {
  kind: CategoryKind;
  period: string;
  total: number;
  carryover: number;
  rows: { label: string; amount: number; planned: number | null }[];
};
export type FixedDue = {
  label: string;
  planned: number;
  paid: number;
  due_day: number | null;
  due_date: string | null;
  days_remaining: number | null;
  status: "paid" | "unset" | "overdue" | "urgent" | "upcoming";
};
