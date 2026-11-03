"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppNav from "@/app/components/app-nav";
import EntryWizard from "@/app/components/entry-wizard";
import UndoLatest from "@/app/components/undo-latest";
import { money, periodLabel, todayInBogota } from "@/lib/format";
import { useDayRefresh } from "@/lib/use-day-refresh";
import type { Account, Categories, DashboardData, FixedDue } from "@/lib/types";

const palette = ["#bc940a", "#40655d", "#f1ab75", "#8eb774", "#8c9db6", "#cd7868", "#6eabaf", "#d7b763", "#a07db5", "#87a09a", "#b7c97d"];

export default function Dashboard({ email, data, categories, baselinePeriod, schedule }: {
  email: string; data: DashboardData; categories: Categories; baselinePeriod: string | null; schedule: FixedDue[];
}) {
  const router = useRouter();
  useDayRefresh();
  const [open, setOpen] = useState(false);
  const [selectedDue, setSelectedDue] = useState<FixedDue | null>(null);
  const [paymentAccount, setPaymentAccount] = useState<Account>("digital");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [latestVersion, setLatestVersion] = useState(0);
  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  const total = (account: Record<"digital" | "cash", number>) => account.digital + account.cash;
  const available = total(data.closing);
  const income = total(data.income);
  const variable = total(data.variable);
  const paid = data.fixed.paid + variable + data.debt_payments;
  const chartItems = data.categories.filter(item => item.amount > 0).sort((a, b) => b.amount - a.amount);
  const chartTotal = chartItems.reduce((sum, item) => sum + item.amount, 0);
  let angle = 0;
  const segments = chartItems.map((item, index) => {
    const start = angle;
    angle += chartTotal ? item.amount / chartTotal * 100 : 0;
    return `${palette[index % palette.length]} ${start}% ${angle}%`;
  });
  const donut = chartTotal ? `conic-gradient(${segments.join(", ")})` : "conic-gradient(#e7eee9 0% 100%)";
  const maxCategory = Math.max(...chartItems.map(item => item.amount), 1);
  const fixedPercent = data.fixed.planned ? Math.min(data.fixed.paid / data.fixed.planned * 100, 100) : 0;
  const alerts = schedule.filter(item => item.status === "urgent" || item.status === "overdue");
  const firstDay = `${data.period}-01`;
  const lastDay = new Date(Date.UTC(Number(data.period.slice(0, 4)), Number(data.period.slice(5, 7)), 0)).toISOString().slice(0, 10);

  function askPayment(item: FixedDue) {
    const today = todayInBogota();
    setPaymentDate(today < firstDay ? firstDay : today > lastDay ? lastDay : today);
    setPaymentAccount("digital");
    setPaymentError("");
    setSelectedDue(item);
  }

  async function confirmPayment() {
    if (!selectedDue) return;
    if (!paymentDate || paymentDate < firstDay || paymentDate > lastDay) {
      setPaymentError("Elige una fecha dentro del período seleccionado.");
      return;
    }
    setPaymentSaving(true); setPaymentError("");
    try {
      const response = await fetch("/api/fixed-payments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: data.period, occurred_on: paymentDate, category: selectedDue.label, account: paymentAccount }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? "No se pudo registrar el pago");
      setSelectedDue(null);
      setLatestVersion(value => value + 1);
      router.refresh();
    } catch (cause) {
      setPaymentError(cause instanceof Error ? cause.message : "No se pudo registrar el pago");
    } finally { setPaymentSaving(false); }
  }

  function saved(date: string) {
    setOpen(false);
    setLatestVersion(value => value + 1);
    if (data.period === date.slice(0, 7)) router.refresh();
    else router.push(`/dashboard?period=${date.slice(0, 7)}`);
  }

  return <div className="app-page"><AppNav email={email} active="dashboard" />
    <main className="dashboard-shell">
      <section className="dashboard-hero">
        <div><span className="hero-kicker">CONTROL PERSONAL · {data.source === "excel" ? "HISTORIAL IMPORTADO" : "REGISTROS DE LA APP"}</span>
          <h1>Tu dinero, de un vistazo</h1><p>Ingresos, gastos y deudas en un mismo lugar.</p></div>
        <div className="hero-actions"><label className="period-picker">Período<select aria-label="Seleccionar período" value={data.period}
          onChange={event => router.push(`/dashboard?period=${event.target.value}`)}>
          {data.periods.map(period => <option key={period} value={period}>{periodLabel(period)}</option>)}
        </select></label></div>
      </section>
      {alerts.length > 0 && <section className="due-alerts" aria-label="Pagos fijos próximos o vencidos">
        <div><strong>Pagos fijos por atender</strong><span>{alerts.length} {alerts.length === 1 ? "compromiso" : "compromisos"} a la vista</span></div>
        <div className="due-alert-list">{alerts.map(item => <button type="button" key={item.label} onClick={() => askPayment(item)} aria-label={`Confirmar si está pagado ${item.label}, valor previsto ${money(item.planned)}`}><span className="due-day red">Día {item.due_day}</span><span>{item.label}<small>{item.status === "overdue" ? `Vencido hace ${Math.abs(item.days_remaining ?? 0)} días` : item.days_remaining === 0 ? "Vence hoy" : `Faltan ${item.days_remaining} días`}</small></span><strong>{money(item.planned)}</strong></button>)}</div>
      </section>}
      <section className="metric-grid" aria-label="Resumen del período">
        <Metric title="Disponible al cierre" value={money(available)} note="Digital + efectivo" featured />
        <Metric title={data.source === "excel" ? "Ingresos" : "Ingresos + saldo inicial"}
          value={money(income + data.carryover)}
          note={data.source === "excel" ? "Recibido en el período" : `Trasladado: ${money(data.carryover)}`} />
        <Metric title="Gastos variables" value={money(variable)} note="Digital + efectivo" />
        <Metric title="Gastos fijos pagados" value={money(data.fixed.paid)} note={data.fixed.planned === null ? "Pagos registrados" : `Previstos: ${money(data.fixed.planned)}`} />
        <Metric title="Deudas en contra" value={money(data.debts.payable)} note="Saldo pendiente" />
      </section>
      <div className="dashboard-grid">
        <section className="viz-card distribution-card"><div className="section-heading"><div><span className="chart-dot" /> <h2>Distribución por categorías</h2></div><p>{data.source === "excel" ? "Agrupación de las celdas auxiliares de septiembre" : "Gastos registrados en este período"}</p></div>
          <div className="distribution-body"><div className="donut" style={{ background: donut }} role="img" aria-label={`Distribución de ${chartItems.length} categorías`}>
            <div className="donut-hole"><small>Total agrupado</small><strong>{money(chartTotal)}</strong></div></div>
            <div className="legend">{chartItems.length ? chartItems.map((item, index) => <div key={item.label}><span className="legend-swatch" style={{ background: palette[index % palette.length] }} /><span>{item.label}</span><strong>{money(item.amount)}</strong></div>) : <p>Aún no hay gastos en este período.</p>}</div></div>
          {data.source === "excel" && <p className="chart-footnote">Como en el Excel, esta agrupación combina valores previstos de gastos fijos con gastos variables realizados. No representa el total pagado.</p>}
        </section>
        <section className="viz-card balance-card"><div className="section-heading"><div><span className="chart-dot" /> <h2>Flujo del dinero</h2></div><p>Balance mensual por cuenta</p></div>
          <div className="flow-stack">
            <FlowRow label="Saldo inicial" value={total(data.opening)} color="#7a9890" max={Math.max(total(data.opening), income, paid, available, 1)} />
            <FlowRow label="Ingresos nuevos" value={income} color="#9e8219" max={Math.max(total(data.opening), income, paid, available, 1)} />
            <FlowRow label="Gastos pagados" value={paid} color="#dfaa79" max={Math.max(total(data.opening), income, paid, available, 1)} />
            <FlowRow label="Saldo final" value={available} color="#40655d" max={Math.max(total(data.opening), income, paid, available, 1)} />
          </div>
          <div className="account-split"><div><small>Digital</small><strong>{money(data.closing.digital)}</strong></div><div><small>Efectivo</small><strong>{money(data.closing.cash)}</strong></div></div>
        </section>
        <section className="viz-card category-card"><div className="section-heading"><div><span className="chart-dot" /> <h2>Valores por categoría</h2></div><p>De mayor a menor</p></div>
          <div className="category-bars">{chartItems.length ? chartItems.map((item, index) => <div className="category-row" key={item.label}><div><span>{item.label}</span><strong>{money(item.amount)}</strong></div><div className="bar-track"><span style={{ width: `${item.amount / maxCategory * 100}%`, background: palette[index % palette.length] }} /></div></div>) : <p>Aún no hay categorías para mostrar.</p>}</div>
        </section>
        <section className="viz-card commitments-card"><div className="section-heading"><div><span className="chart-dot" /> <h2>Compromisos y deudas</h2></div><p>Estado al cierre del período</p></div>
          <div className="commitment-line"><span>Gastos fijos pagados</span><strong>{money(data.fixed.paid)}</strong></div>
          {data.fixed.planned !== null && <><div className="budget-track"><span style={{ width: `${fixedPercent}%` }} /></div><p className="muted">{Math.round(data.fixed.planned ? data.fixed.paid / data.fixed.planned * 100 : 0)}% de {money(data.fixed.planned)} previstos</p></>}
          <div className="commitment-line"><span>Deudas en contra</span><strong>{money(data.debts.payable)}</strong></div>
          <div className="commitment-line"><span>Deudas a favor</span><strong>{money(data.debts.receivable)}</strong></div>
          {data.debt_payments > 0 && <div className="commitment-line"><span>Abonos a deuda</span><strong>{money(data.debt_payments)}</strong></div>}
        </section>
      </div>
    </main>
    <UndoLatest refreshKey={latestVersion} floating />
    <button className="floating-add" type="button" aria-label="Agregar movimiento o valor" title="Agregar movimiento o valor" onClick={() => setOpen(true)}>+</button>
    {open && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}><div className="entry-modal" role="dialog" aria-modal="true" aria-label="Agregar movimiento o valor"><div className="modal-top"><span>Nuevo registro</span><button type="button" aria-label="Cerrar" onClick={() => setOpen(false)}>×</button></div>
      <EntryWizard categories={categories} baselinePeriod={baselinePeriod} onSaved={saved} onCancel={() => setOpen(false)} /></div></div>}
    {selectedDue && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !paymentSaving) setSelectedDue(null); }}><div className="undo-dialog" role="dialog" aria-modal="true" aria-labelledby="fixed-payment-title">
      <h2 id="fixed-payment-title">¿Está pagado {selectedDue.label}?</h2>
      <p>Al elegir “Sí”, se registrará {money(selectedDue.planned)} como gasto fijo de {periodLabel(data.period)} y se descontará del disponible.</p>
      <label className="field">Fecha del pago<input type="date" min={firstDay} max={lastDay} value={paymentDate} onChange={event => setPaymentDate(event.target.value)} /></label>
      <label className="field">Cuenta desde la que pagaste<select value={paymentAccount} onChange={event => setPaymentAccount(event.target.value as Account)}><option value="digital">Digital</option><option value="cash">Efectivo</option></select></label>
      {selectedDue.planned <= 0 && <p className="error">Configura un valor previsto mayor que cero antes de marcarlo como pagado.</p>}
      {paymentError && <p className="error" role="alert">{paymentError}</p>}
      <div className="wizard-actions"><button type="button" className="button-quiet" disabled={paymentSaving} onClick={() => setSelectedDue(null)}>No, aún no</button><button type="button" className="button-primary" disabled={paymentSaving || selectedDue.planned <= 0} onClick={confirmPayment}>{paymentSaving ? "Registrando…" : "Sí, está pagado"}</button></div>
    </div></div>}
  </div>;
}

function Metric({ title, value, note, featured = false }: { title: string; value: string; note: string; featured?: boolean }) {
  return <div className={`metric-card${featured ? " metric-featured" : ""}`}><span>{title}</span><strong>{value}</strong><small>{note}</small></div>;
}

function FlowRow({ label, value, color, max }: { label: string; value: number; color: string; max: number }) {
  return <div className="flow-row"><div><span>{label}</span><strong>{money(value)}</strong></div><div className="bar-track"><span style={{ width: `${Math.max(value, 0) / max * 100}%`, background: color }} /></div></div>;
}
