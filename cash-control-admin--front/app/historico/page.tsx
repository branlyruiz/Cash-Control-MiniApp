import Link from "next/link";
import { redirect } from "next/navigation";
import { authHeaders, backend } from "@/lib/backend";
import { money, periodLabel } from "@/lib/format";
import type { DashboardData } from "@/lib/types";
import AppNav from "@/app/components/app-nav";

type Income = { id: number; label: string; digital: number; cash: number; source_row: number };
type Fixed = { id: number; label: string; planned: number; paid: number; due_day: number | null; source_row: number };
type Variable = { id: number; label: string; digital: number; cash: number; source_row: number };
type Debt = { id: number; direction: "payable" | "receivable"; label: string; original: number; paid: number; balance: number; source_row: number };
type Month = {
  period: string; opening_digital: number; opening_cash: number; transfer_cash_to_digital: number;
  closing_digital: number; closing_cash: number; source_file: string; imported_at: string;
  income: Income[]; fixed_expenses: Fixed[]; variable_expenses: Variable[]; debts: Debt[];
};

const total = <T,>(rows: T[], key: keyof T) => rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);

function DataTable({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return <div className="table-scroll"><table className="data-table"><thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>
    {rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}
  </tbody></table></div>;
}

function BalanceLine({ label, value, isTotal = false }: { label: string; value: number; isTotal?: boolean }) {
  return <div className={`balance-line${isTotal ? " total" : ""}`}><span>{label}</span><strong>{money(value)}</strong></div>;
}

export default async function BalancePage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const headers = await authHeaders();
  if (!headers) redirect("/");
  const { period } = await searchParams;
  let unauthorized = false;
  let data: DashboardData | null = null;
  let month: Month | null = null;
  let email = "";
  try {
    const [response, me] = await Promise.all([
      backend(`/dashboard-data${period ? `?period=${encodeURIComponent(period)}` : ""}`, { headers }),
      backend("/auth/me", { headers }),
    ]);
    unauthorized = response.status === 401 || me.status === 401;
    if (response.ok) data = await response.json() as DashboardData;
    if (me.ok) email = (await me.json()).email;
    if (data?.source === "excel" && data.period === "2026-09") {
      const history = await backend("/history/months/2026-09", { headers });
      unauthorized ||= history.status === 401;
      if (history.ok) month = await history.json() as Month;
    }
  } catch { /* La página muestra el error de carga más abajo. */ }
  if (unauthorized) redirect("/");
  if (!data) return <main className="shell"><Link href="/dashboard">← Volver al panel</Link><h1>Balance</h1><p>No se pudo cargar el balance. Comprueba que el backend esté en ejecución.</p></main>;

  const cash = data.closing.digital + data.closing.cash;
  const receivableBalance = data.debts.receivable;
  const payableBalance = data.debts.payable;
  const assets = cash + receivableBalance;
  const equity = assets - payableBalance;
  const income = data.income.digital + data.income.cash;
  const expenses = data.fixed.paid + data.variable.digital + data.variable.cash + data.debt_payments;

  return <div className="app-page"><AppNav email={email} active="historico" /><main className="shell historical">
    <Link className="history-link" href="/dashboard">← Volver al panel</Link>
    <header className="history-heading"><span className="eyebrow">BALANCE MENSUAL</span><h1>Balance</h1><p>Consulta los valores del mes y su posición al cierre de {periodLabel(data.period)}.</p></header>
    <nav className="balance-periods" aria-label="Meses del balance">{data.periods.map(item => <Link key={item} href={`/historico?period=${item}`} aria-current={item === data.period ? "page" : undefined}>{periodLabel(item)}</Link>)}</nav>
    <section className="cards" aria-label={`Cierre de ${periodLabel(data.period)}`}>
      <div className="card featured"><span>Disponible al cierre</span><strong>{money(cash)}</strong></div>
      <div className="card"><span>Digital al cierre</span><strong>{money(data.closing.digital)}</strong></div>
      <div className="card"><span>Efectivo al cierre</span><strong>{money(data.closing.cash)}</strong></div>
      <div className="card"><span>Ingresos del mes</span><strong>{money(income)}</strong></div>
      <div className="card"><span>Salidas del mes</span><strong>{money(expenses)}</strong></div>
    </section>
    {month && <ImportedDetails month={month} />}
    <section className="panel history-section" aria-label="Balance general del mes">
      <h2>Balance general · {periodLabel(data.period)}</h2>
      <p>Posición calculada con los saldos al cierre de este mes.</p>
      <div className="balance-grid">
        <div><h3>Activos</h3><div className="balance-lines">
          <BalanceLine label="Cuenta digital" value={data.closing.digital} />
          <BalanceLine label="Efectivo" value={data.closing.cash} />
          <BalanceLine label="Cuentas por cobrar · deudas a favor" value={receivableBalance} />
          <BalanceLine label="Total activos" value={assets} isTotal />
        </div></div>
        <div><h3>Pasivos y patrimonio</h3><div className="balance-lines">
          <BalanceLine label="Cuentas por pagar · deudas en contra" value={payableBalance} />
          <BalanceLine label="Patrimonio calculado" value={equity} />
          <BalanceLine label="Total pasivos + patrimonio" value={payableBalance + equity} isTotal />
        </div></div>
      </div>
      <p className="balance-equation">Activos {money(assets)} = Pasivos {money(payableBalance)} + Patrimonio {money(equity)}</p>
      <p className="balance-note">Este balance incluye únicamente dinero en cuentas y deudas registradas. No contempla otros bienes, inversiones u obligaciones que no figuren en Cash Control.</p>
    </section>
  </main></div>;
}

function ImportedDetails({ month }: { month: Month }) {
  const fixedPlanned = total(month.fixed_expenses, "planned");
  const fixedPaid = total(month.fixed_expenses, "paid");
  const payable = month.debts.filter(debt => debt.direction === "payable");
  const receivable = month.debts.filter(debt => debt.direction === "receivable");
  return <>
    <section className="panel history-section"><h2>Detalle importado del Excel</h2><p>Fuente: {month.source_file}. Los importes son mensuales; la hoja no indica la fecha exacta de cada compra.</p></section>
    <section className="panel history-section"><h2>Flujo entre cuentas</h2><div className="flow-grid">
      <div><span>Saldo inicial digital</span><strong>{money(month.opening_digital)}</strong></div>
      <div><span>Saldo inicial efectivo</span><strong>{money(month.opening_cash)}</strong></div>
      <div><span>Ingresos digitales</span><strong>{money(total(month.income, "digital"))}</strong></div>
      <div><span>Ingresos en efectivo</span><strong>{money(total(month.income, "cash"))}</strong></div>
      <div><span>Transferido de efectivo a digital</span><strong>{money(month.transfer_cash_to_digital)}</strong></div>
      <div><span>Gasto variable digital</span><strong>{money(total(month.variable_expenses, "digital"))}</strong></div>
      <div><span>Gasto variable efectivo</span><strong>{money(total(month.variable_expenses, "cash"))}</strong></div>
      <div><span>Gasto fijo pagado</span><strong>{money(fixedPaid)}</strong></div>
    </div></section>
    <section className="panel history-section"><h2>Ingresos</h2><DataTable headers={["Actividad", "Digital", "Efectivo"]} rows={month.income.map(item => [item.label, money(item.digital), money(item.cash)])} /></section>
    <section className="panel history-section"><h2>Gastos fijos</h2><p>Valor previsto: {money(fixedPlanned)} · Abonos registrados: {money(fixedPaid)}</p><DataTable headers={["Concepto", "Valor previsto", "Abono", "Día de pago"]} rows={month.fixed_expenses.map(item => [item.label, money(item.planned), money(item.paid), item.due_day ?? "—"])} /></section>
    <section className="panel history-section"><h2>Gastos varios</h2><DataTable headers={["Concepto", "Digital", "Efectivo"]} rows={month.variable_expenses.map(item => [item.label, money(item.digital), money(item.cash)])} /></section>
    <section className="panel history-section"><h2>Deudas en contra</h2><DataTable headers={["Concepto", "Valor", "Abono", "Saldo"]} rows={payable.map(item => [item.label, money(item.original), money(item.paid), money(item.balance)])} /></section>
    <section className="panel history-section"><h2>Deudas a favor</h2><DataTable headers={["Concepto", "Valor", "Abono", "Saldo"]} rows={receivable.map(item => [item.label, money(item.original), money(item.paid), money(item.balance)])} /><p className="hint">Los abonos a favor se muestran como seguimiento de deuda; no se suman otra vez a los ingresos.</p></section>
  </>;
}
