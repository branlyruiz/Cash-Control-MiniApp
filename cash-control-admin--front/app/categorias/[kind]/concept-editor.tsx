"use client";

import { useEffect, useState } from "react";
import { money } from "@/lib/format";
import type { Account, CategoryKind } from "@/lib/types";

type Entry = { entry_type: "transaction" | "debt" | "payment"; id: number; occurred_on: string; amount: number; account: Account | null; description: string };
type Details = { label: string; amount: number; planned: number | null; period: string; kind: CategoryKind; editable: boolean; calculated: boolean; receivable_concept: boolean; entries: Entry[] };

export default function ConceptEditor({ kind, period, label, onClose, onChanged }: {
  kind: CategoryKind; period: string; label: string; onClose: () => void; onChanged: () => void;
}) {
  const [details, setDetails] = useState<Details | null>(null);
  const [name, setName] = useState(label);
  const [newAmount, setNewAmount] = useState("");
  const [planned, setPlanned] = useState("");
  const [newDate, setNewDate] = useState(`${period}-01`);
  const [account, setAccount] = useState<Account>("digital");
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmEntry, setConfirmEntry] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const path = `/api/concepts/${encodeURIComponent(kind)}?label=${encodeURIComponent(label)}&period=${encodeURIComponent(period)}`;
  const monthEnd = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10);

  useEffect(() => {
    let mounted = true;
    fetch(path).then(async response => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.detail ?? "No se pudo cargar el concepto");
      return value as Details;
    }).then(value => {
      if (!mounted) return;
      setDetails(value);
      setPlanned(String(value.planned ?? 0));
      setAmounts(Object.fromEntries(value.entries.map(entry => [entry.id, String(entry.amount)])));
    }).catch(cause => { if (mounted) setError(cause instanceof Error ? cause.message : "No se pudo cargar el concepto"); });
    return () => { mounted = false; };
  }, [path]);

  async function request(url: string, method: "PATCH" | "POST" | "DELETE" | "PUT", body?: object) {
    setBusy(true); setError("");
    try {
      const response = await fetch(url, {
        method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.detail ?? "No se pudo guardar el cambio");
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar el cambio");
      setBusy(false);
    }
  }

  function saveName() {
    if (!name.trim() || name.trim().length > 80) { setError("Escribe un nombre de hasta 80 caracteres."); return; }
    request(path, "PATCH", { name: name.trim() });
  }

  function savePlanned() {
    const amount = Number(planned);
    if (!Number.isSafeInteger(amount) || amount < 0) { setError("Escribe un valor previsto entero de cero o más pesos."); return; }
    request(`/api/fixed-plans/${encodeURIComponent(label)}?period=${encodeURIComponent(period)}`, "PUT", { amount });
  }

  function saveAmount(entry: Entry) {
    const amount = Number(amounts[entry.id]);
    if (!Number.isSafeInteger(amount) || amount <= 0) { setError("Escribe un valor entero mayor que cero."); return; }
    request(`/api/concept-entries/${entry.entry_type}/${entry.id}`, "PATCH", { amount });
  }

  function addValue() {
    const amount = Number(newAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0) { setError("Escribe un valor entero mayor que cero."); return; }
    if (newDate < `${period}-01` || newDate > monthEnd) { setError("Elige una fecha dentro del período seleccionado."); return; }
    if (kind === "payable" || kind === "receivable" || details?.receivable_concept) {
      request("/api/debt-payments", "POST", { occurred_on: newDate,
        direction: kind === "income" ? "receivable" : kind, concept: label, account, amount, description: "" });
    } else {
      request("/api/transactions", "POST", {
        occurred_on: newDate, kind: kind === "income" ? "income" : "expense", account,
        target_account: null, category: label, expense_class: kind === "income" ? null : kind,
        description: "", amount,
      });
    }
  }

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="entry-modal concept-modal" role="dialog" aria-modal="true" aria-labelledby="concept-title">
      <div className="modal-top"><span id="concept-title">{label}</span><button type="button" aria-label="Cerrar" onClick={onClose} disabled={busy}>×</button></div>
      <div className="concept-modal-body">
        {!details && !error && <p>Cargando concepto…</p>}
        {details && <><div className="concept-total"><span>Valor mostrado en {period}</span><strong>{money(details.amount)}</strong></div>
          {kind === "fixed" && <div className="concept-total concept-planned-total"><span>Valor previsto mensual</span><strong>{money(details.planned ?? 0)}</strong></div>}
          {!details.editable ? <p className="info-tile">{details.calculated
            ? "Este disponible se calcula automáticamente a partir del cierre del mes anterior. Para cambiarlo, corrige un movimiento del mes de origen."
            : "Este valor proviene del Excel importado y se conserva como historial. Puedes editar los registros de los meses posteriores."}</p>
          : <>
            {kind === "fixed" && <section className="concept-edit-section"><h3>Valor previsto del gasto fijo</h3><p>Se aplicará desde {period} a los meses siguientes. Los pagos registrados no cambian.</p><div className="concept-inline"><input aria-label="Valor previsto del gasto fijo" type="number" min="0" step="1" inputMode="numeric" value={planned} onChange={event => setPlanned(event.target.value)} /><button type="button" className="button-primary" disabled={busy || planned === String(details.planned ?? 0)} onClick={savePlanned}>Guardar previsto</button></div></section>}
            {kind === "income" && details.receivable_concept ? <p className="info-tile">Este concepto corresponde a una deuda a favor. Puedes editar sus abonos aquí; para renombrarlo, usa la vista Deudas a favor.</p>
              : <section className="concept-edit-section"><h3>Nombre del concepto</h3><div className="concept-inline"><input aria-label="Nombre del concepto" maxLength={80} value={name} onChange={event => setName(event.target.value)} /><button type="button" className="button-primary" disabled={busy || name.trim() === label} onClick={saveName}>Guardar nombre</button></div></section>}
            <section className="concept-edit-section"><h3>Valores registrados</h3>
              {details.entries.length ? details.entries.map(entry => <div className="concept-entry" key={`${entry.entry_type}-${entry.id}`}>
                <div className="concept-entry-heading"><span>{entry.entry_type === "payment" ? "Abono · " : entry.entry_type === "debt" ? "Deuda nueva · " : ""}{entry.occurred_on} · {entry.account === "cash" ? "Efectivo" : entry.account === "digital" ? "Digital" : "Sin cuenta"}{entry.description ? ` · ${entry.description}` : ""}</span></div>
                <div className="concept-inline"><input aria-label={`Valor del registro del ${entry.occurred_on}`} type="number" min="1" step="1" inputMode="numeric" value={amounts[entry.id] ?? ""} onChange={event => setAmounts(current => ({ ...current, [entry.id]: event.target.value }))} />
                  <button type="button" className="button-primary" disabled={busy || amounts[entry.id] === String(entry.amount)} onClick={() => saveAmount(entry)}>Guardar valor</button>
                  <button type="button" className="button-danger-soft" disabled={busy} onClick={() => setConfirmEntry(entry.id)}>Eliminar</button></div>
                {confirmEntry === entry.id && <div className="concept-confirm"><span>¿Eliminar este valor de {money(entry.amount)}?</span><button type="button" onClick={() => setConfirmEntry(null)}>Cancelar</button><button type="button" className="button-danger" disabled={busy} onClick={() => request(`/api/concept-entries/${entry.entry_type}/${entry.id}`, "DELETE")}>Sí, eliminar</button></div>}
              </div>) : <p className="muted">Todavía no hay valores registrados para este concepto en {period}.</p>}
            </section>
            <section className="concept-edit-section"><h3>{kind === "payable" || kind === "receivable" || details.receivable_concept ? "Registrar un abono" : "Agregar un valor"}</h3><div className="concept-new-value"><label>Fecha<input type="date" min={`${period}-01`} max={monthEnd} value={newDate} onChange={event => setNewDate(event.target.value)} /></label>
              <label>Cuenta<select value={account} onChange={event => setAccount(event.target.value as Account)}><option value="digital">Digital</option><option value="cash">Efectivo</option></select></label>
              <label>Valor en pesos<input type="number" min="1" step="1" inputMode="numeric" value={newAmount} onChange={event => setNewAmount(event.target.value)} /></label>
              <button type="button" className="button-primary" disabled={busy} onClick={addValue}>{kind === "payable" || kind === "receivable" || details.receivable_concept ? "Guardar abono" : "Agregar valor"}</button></div></section>
            {!(kind === "income" && details.receivable_concept) && <section className="concept-edit-section concept-remove"><h3>Eliminar concepto</h3><p>Elimina sus valores de {period} y oculta el concepto de las listas futuras. El historial importado se conserva.</p>
              {!confirmDelete ? <button type="button" className="button-danger-soft" disabled={busy} onClick={() => setConfirmDelete(true)}>Eliminar concepto</button>
                : <div className="concept-confirm"><span>¿Eliminar «{label}» y sus {details.entries.length} valores de este mes?</span><button type="button" onClick={() => setConfirmDelete(false)}>Cancelar</button><button type="button" className="button-danger" disabled={busy} onClick={() => request(path, "DELETE")}>Sí, eliminar concepto</button></div>}
            </section>}
          </>}
        </>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </div>
  </div>;
}
