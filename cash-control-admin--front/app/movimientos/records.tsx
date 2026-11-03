"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AppNav from "@/app/components/app-nav";
import EntryWizard from "@/app/components/entry-wizard";
import UndoLatest from "@/app/components/undo-latest";
import { money } from "@/lib/format";
import type { Categories, Debt, DebtPayment, Movement, Summary } from "@/lib/types";

type EntryToDelete = { entryType: "transaction" | "debt" | "payment"; id: number; label: string; amount: number; date: string };

export default function Records({ email, summary, movements, debts, payments, categories }: {
  email: string; summary: Summary; movements: Movement[]; debts: Debt[]; payments: DebtPayment[]; categories: Categories;
}) {
  const router = useRouter();
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<EntryToDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  function saved() { setOpen(false); setVersion(value => value + 1); router.refresh(); }
  async function deleteSelected() {
    if (!selected) return;
    setDeleting(true); setDeleteError("");
    try {
      const response = await fetch(`/api/concept-entries/${selected.entryType}/${selected.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? "No se pudo eliminar el registro");
      setSelected(null);
      setVersion(value => value + 1);
      router.refresh();
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "No se pudo eliminar el registro");
    } finally { setDeleting(false); }
  }
  function askDelete(entry: EntryToDelete) { setSelected(entry); setDeleteError(""); }
  const recent = [...movements].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.id - a.id);
  const recentDebts = [...debts].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.id - a.id);
  const recentPayments = [...payments].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.id - a.id);
  return <div className="app-page"><AppNav email={email} active="movimientos" />
    <main className="records-shell"><header className="records-heading"><span className="eyebrow">REGISTRO</span><h1>Movimientos</h1><p>Consulta tus movimientos, deudas y abonos. Usa el botón + para agregar un registro.</p></header>
      <div className="records-history"><section className="viz-card"><div className="section-heading"><div><span className="chart-dot" /><h2>Movimientos recientes</h2></div></div>
          {recent.length ? <div className="record-list">{recent.slice(0, 12).map(item => <div className="record-item" key={item.id}><div><strong>{item.category}</strong><small>{item.occurred_on} · {item.account === "cash" ? "Efectivo" : "Digital"}{item.description ? ` · ${item.description}` : ""}</small></div><div className="record-actions"><b className={item.kind === "income" ? "positive" : ""}>{item.kind === "income" ? "+" : item.kind === "expense" ? "−" : ""}{money(item.amount)}</b><span className="record-action-divider" aria-hidden="true" /><button type="button" onClick={() => askDelete({ entryType: "transaction", id: item.id, label: item.category, amount: item.amount, date: item.occurred_on })} aria-label={`Eliminar movimiento ${item.category} del ${item.occurred_on}`}>Eliminar</button></div></div>)}</div> : <p className="muted">Aún no hay movimientos nuevos.</p>}
        </section><section className="viz-card"><div className="section-heading"><div><span className="chart-dot" /><h2>Deudas registradas</h2></div></div>
          {recentDebts.length ? <div className="record-list">{recentDebts.slice(0, 8).map(item => <div className="record-item" key={item.id}><div><strong>{item.concept}</strong><small>{item.occurred_on} · {item.direction === "payable" ? "En contra" : "A favor"}</small></div><div className="record-actions"><b>{money(item.amount)}</b><span className="record-action-divider" aria-hidden="true" /><button type="button" onClick={() => askDelete({ entryType: "debt", id: item.id, label: item.concept, amount: item.amount, date: item.occurred_on })} aria-label={`Eliminar deuda ${item.concept} del ${item.occurred_on}`}>Eliminar</button></div></div>)}</div> : <p className="muted">Aún no hay deudas nuevas.</p>}
        </section><section className="viz-card"><div className="section-heading"><div><span className="chart-dot" /><h2>Abonos de deuda</h2></div></div>
          {recentPayments.length ? <div className="record-list">{recentPayments.slice(0, 8).map(item => <div className="record-item" key={item.id}><div><strong>{item.concept}</strong><small>{item.occurred_on} · {item.direction === "payable" ? "Pago de deuda en contra" : "Cobro de deuda a favor"} · {item.account === "cash" ? "Efectivo" : "Digital"}</small></div><div className="record-actions"><b className={item.direction === "receivable" ? "positive" : ""}>{item.direction === "receivable" ? "+" : "−"}{money(item.amount)}</b><span className="record-action-divider" aria-hidden="true" /><button type="button" onClick={() => askDelete({ entryType: "payment", id: item.id, label: item.concept, amount: item.amount, date: item.occurred_on })} aria-label={`Eliminar abono ${item.concept} del ${item.occurred_on}`}>Eliminar</button></div></div>)}</div> : <p className="muted">Aún no hay abonos registrados.</p>}
        </section></div>
    </main><UndoLatest refreshKey={version} floating />
    <button className="floating-add" type="button" aria-label="Agregar movimiento o valor" title="Agregar movimiento o valor" onClick={() => setOpen(true)}>+</button>
    {open && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}><div className="entry-modal" role="dialog" aria-modal="true" aria-label="Agregar movimiento o valor"><div className="modal-top"><span>Nuevo registro</span><button type="button" aria-label="Cerrar" onClick={() => setOpen(false)}>×</button></div>
      <EntryWizard categories={categories} baselinePeriod={summary.baseline_period} onSaved={saved} onCancel={() => setOpen(false)} /></div></div>}
    {selected && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !deleting) setSelected(null); }}><div className="undo-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-entry-title">
      <h2 id="delete-entry-title">¿Eliminar este registro?</h2><p>Se actualizarán los saldos y resúmenes asociados.</p>
      <div className="undo-detail"><strong>{selected.label}</strong><span>{selected.date}</span><b>{money(selected.amount)}</b></div>
      {deleteError && <p className="error" role="alert">{deleteError}</p>}
      <div className="wizard-actions"><button type="button" className="button-quiet" disabled={deleting} onClick={() => setSelected(null)}>Cancelar</button><button type="button" className="button-danger" disabled={deleting} onClick={deleteSelected}>{deleting ? "Eliminando…" : "Sí, eliminar"}</button></div>
    </div></div>}
  </div>;
}
