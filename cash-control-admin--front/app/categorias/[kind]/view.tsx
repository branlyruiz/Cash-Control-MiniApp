"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import AppNav from "@/app/components/app-nav";
import EntryWizard from "@/app/components/entry-wizard";
import UndoLatest from "@/app/components/undo-latest";
import ConceptEditor from "./concept-editor";
import { money, periodLabel } from "@/lib/format";
import { useDayRefresh } from "@/lib/use-day-refresh";
import type { Categories, CategoryKind, CategoryOverview, FixedDue } from "@/lib/types";

const labels: Record<CategoryKind, string> = {
  income: "Ingresos", variable: "Gastos variables", fixed: "Gastos fijos",
  receivable: "Deudas a favor", payable: "Deudas en contra",
};
const subtitles: Record<CategoryKind, string> = {
  income: "Fuentes de dinero que recibiste.", variable: "Gastos que cambian de un mes a otro.",
  fixed: "Compromisos recurrentes y sus fechas de pago.", receivable: "Dinero que tienes por cobrar.",
  payable: "Dinero que tienes pendiente por pagar.",
};
const palettes: Record<CategoryKind, string[]> = {
  income: ["#b99524", "#42675c", "#f1a87a", "#8eb675", "#8b9cb7", "#cb786b", "#83abb0", "#a589bd"],
  variable: ["#d77729", "#f2a554", "#af521d", "#e28b48", "#f5bb7b", "#bd6432", "#e9a06b", "#93491e"],
  fixed: ["#8060b4", "#a488ce", "#62448e", "#b9a0dc", "#916cbd", "#715097", "#c8b6e7", "#513875"],
  receivable: ["#42a9d1", "#1d87ae", "#80c9e2", "#27769e", "#61b9dc", "#a0d7e9", "#3e96bd", "#18658c"],
  payable: ["#c74b52", "#a93440", "#e47d78", "#952c38", "#d96062", "#ed9990", "#b54850", "#812b37"],
};

export default function CategoryView({ email, kind, overview, periods, categories, schedule, baselinePeriod, available }: {
  email: string; kind: CategoryKind; overview: CategoryOverview; periods: string[]; categories: Categories;
  schedule: FixedDue[]; baselinePeriod: string | null; available: number;
}) {
  const router = useRouter();
  useDayRefresh();
  const [open, setOpen] = useState(false);
  const [selectedConcept, setSelectedConcept] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const colors = palettes[kind];
  const positive = overview.rows.filter(row => row.amount > 0);
  const max = Math.max(...positive.map(row => row.amount), 1);
  let angle = 0;
  const gradient = positive.length ? `conic-gradient(${positive.map((row, index) => {
    const start = angle;
    angle += row.amount / overview.total * 100;
    return `${colors[index % colors.length]} ${start}% ${angle}%`;
  }).join(", ")})` : "conic-gradient(#e8eee9 0% 100%)";
  const fixedPlan = overview.rows.reduce((sum, row) => sum + (row.planned ?? 0), 0);
  const top = positive[0];
  function saved(date: string) {
    setOpen(false);
    setVersion(value => value + 1);
    if (overview.period === date.slice(0, 7)) router.refresh();
    else router.push(`/categorias/${kind}?period=${date.slice(0, 7)}`);
  }
  return <div className={`app-page category-theme category-theme-${kind}`}><AppNav email={email} active="categorias" />
    <main className="category-shell">
      <header className="category-hero"><div><span className="hero-kicker">MIS CATEGORÍAS</span><h1>{labels[kind]}</h1><p>{subtitles[kind]}</p></div>
        <label className="period-picker">Período<select value={overview.period} aria-label="Seleccionar período" onChange={event => router.push(`/categorias/${kind}?period=${event.target.value}`)}>
          {periods.map(period => <option key={period} value={period}>{periodLabel(period)}</option>)}
        </select></label></header>
      <nav className="category-tabs" aria-label="Tipos de categoría">{(Object.keys(labels) as CategoryKind[]).map(item => <Link key={item} data-kind={item} href={`/categorias/${item}?period=${overview.period}`} aria-current={kind === item ? "page" : undefined}>{labels[item]}</Link>)}</nav>
      <section className="category-metrics" aria-label="Resumen de esta categoría">
        <div><span>{kind === "income" && overview.carryover ? "Disponible" : kind === "fixed" ? "Pagado" : kind === "payable" || kind === "receivable" ? "Saldo por concepto" : "Total del período"}</span><strong>{money(overview.total)}</strong></div>
        <div><span>{kind === "income" && overview.carryover ? "Saldo mes anterior" : "Conceptos"}</span><strong>{kind === "income" && overview.carryover ? money(overview.carryover) : overview.rows.length}</strong></div>
        <div><span>{kind === "income" && overview.carryover ? "Ingresos nuevos" : kind === "fixed" ? "Previsto" : "Mayor concepto"}</span><strong>{kind === "income" && overview.carryover ? money(overview.total - overview.carryover) : kind === "fixed" ? money(fixedPlan) : top ? top.label : "—"}</strong></div>
        {kind === "payable" && <div><span>Disponible al cierre · {periodLabel(overview.period)}</span><strong>{money(available)}</strong></div>}
      </section>
      <div className="category-layout"><section className="viz-card category-donut-card"><div className="section-heading"><div><span className="chart-dot" /><h2>Distribución</h2></div><p>Participación de cada concepto</p></div>
        <div className="donut compact-donut" style={{ background: gradient }} role="img" aria-label={`Distribución de ${positive.length} conceptos`}><div className="donut-hole"><small>Total</small><strong>{money(overview.total)}</strong></div></div>
        <div className="category-legend">{positive.slice(0, 8).map((row, index) => <div key={row.label}><span className="legend-swatch" style={{ background: colors[index % colors.length] }} />{row.label}<b>{Math.round(row.amount / overview.total * 100)}%</b></div>)}</div>
        {!positive.length && <p className="muted">Aún no hay valores para este período.</p>}
      </section>
      <section className="viz-card category-detail-card"><div className="section-heading"><div><span className="chart-dot" /><h2>Valores por concepto</h2></div><p>Selecciona un concepto para editarlo o eliminarlo</p></div>
        <div className="category-bars">{overview.rows.length ? overview.rows.map((row, index) => <button type="button" className="category-row category-row-button" key={row.label} onClick={() => setSelectedConcept(row.label)} aria-label={`Editar concepto ${row.label}, valor ${money(row.amount)}`}><div><span>{row.label}</span><span className="concept-edit-cue" aria-hidden="true">✎</span><strong>{money(row.amount)}</strong></div><div className="bar-track"><span style={{ width: `${row.amount / max * 100}%`, background: colors[index % colors.length] }} /></div>
          {kind === "fixed" && <small className="muted">Previsto: {money(row.planned ?? 0)}</small>}</button>) : <p className="muted">Aún no hay valores registrados.</p>}</div>
      </section></div>
      {kind === "fixed" && <section className="viz-card due-section"><div className="section-heading"><div><span className="chart-dot" /><h2>Días de pago</h2></div><p>La cuenta regresiva se basa en el día de cada mes. Puedes cambiarlo.</p></div>
        <div className="due-grid">{schedule.map(item => <DueCard key={`${item.label}-${item.due_day}`} item={item} onSaved={() => router.refresh()} />)}</div>
      </section>}
    </main>
    <UndoLatest refreshKey={version} floating />
    <button type="button" className="floating-add" aria-label={kind === "payable" ? "Registrar abono a deuda en contra" : kind === "receivable" ? "Registrar cobro de deuda a favor" : `Agregar valor en ${labels[kind]}`} title={kind === "payable" ? "Registrar abono a deuda en contra" : kind === "receivable" ? "Registrar cobro de deuda a favor" : `Agregar valor en ${labels[kind]}`} onClick={() => setOpen(true)}>+</button>
    {open && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}><div className="entry-modal" role="dialog" aria-modal="true" aria-label={`Agregar valor en ${labels[kind]}`}><div className="modal-top"><span>Nuevo registro · {labels[kind]}</span><button type="button" aria-label="Cerrar" onClick={() => setOpen(false)}>×</button></div>
      <EntryWizard categories={categories} baselinePeriod={baselinePeriod} initialType={kind} lockType paymentMode={kind === "payable"} onSaved={saved} onCancel={() => setOpen(false)} /></div></div>}
    {selectedConcept && <ConceptEditor key={`${kind}-${overview.period}-${selectedConcept}`} kind={kind} period={overview.period} label={selectedConcept}
      onClose={() => setSelectedConcept(null)} onChanged={() => { setSelectedConcept(null); setVersion(value => value + 1); router.replace(`/categorias/${kind}?period=${overview.period}`); router.refresh(); }} />}
  </div>;
}

function DueCard({ item, onSaved }: { item: FixedDue; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [day, setDay] = useState(String(item.due_day ?? ""));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const hue = item.status === "paid" ? 145 : item.days_remaining === null ? 210 : Math.max(0, Math.min(120, item.days_remaining * 4));
  const dayColor = `hsl(${hue} 55% 43%)`;
  async function save() {
    const value = Number(day);
    if (!Number.isInteger(value) || value < 1 || value > 31) { setError("Elige un día entre 1 y 31."); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/fixed-schedule/${encodeURIComponent(item.label)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ due_day: value }),
      });
      if (!response.ok) { const result = await response.json(); throw new Error(result.detail ?? "No se pudo guardar el día"); }
      setEditing(false); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar el día"); }
    finally { setSaving(false); }
  }
  return <article className="due-card"><div className="due-card-top"><span className="due-day" style={{ background: dayColor }}>Día {item.due_day ?? "—"}</span><span className={`due-status ${item.status}`}>{item.status === "paid" ? "Pagado" : item.status === "overdue" ? "Vencido" : item.status === "urgent" ? "Próximo" : item.status === "unset" ? "Sin fecha" : "Pendiente"}</span></div>
    <strong>{item.label}</strong><p>{item.status === "paid" ? `Pagado este mes: ${money(item.paid)}` : item.days_remaining === null ? "Asigna un día de pago" : item.days_remaining < 0 ? `Venció hace ${Math.abs(item.days_remaining)} días` : item.days_remaining === 0 ? "Vence hoy" : `Faltan ${item.days_remaining} días`}</p>
    <div className="due-card-bottom"><span>{money(item.planned)} previsto</span><button type="button" onClick={() => setEditing(value => !value)}>{editing ? "Cancelar" : "Cambiar día"}</button></div>
    {editing && <div className="due-edit"><label>Día del mes<input type="number" min="1" max="31" value={day} onChange={event => setDay(event.target.value)} /></label><button type="button" disabled={saving} onClick={save}>{saving ? "Guardando…" : "Guardar"}</button></div>}
    {error && <p className="error" role="alert">{error}</p>}
  </article>;
}
