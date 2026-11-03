"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/format";

type Latest = { entry_type: "transaction" | "debt" | "payment"; id: number; occurred_on: string; label: string; amount: number };

export default function UndoLatest({ refreshKey = 0, floating = false }: { refreshKey?: number; floating?: boolean }) {
  const router = useRouter();
  const [latest, setLatest] = useState<Latest | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    fetch("/api/entries/latest").then(async response => {
      if (!response.ok) throw new Error("No se pudo consultar el último registro");
      return response.json();
    }).then(data => { if (mounted) setLatest(data as Latest | null); })
      .catch(cause => { if (mounted) setError(cause.message); });
    return () => { mounted = false; };
  }, [refreshKey]);

  async function remove() {
    if (!latest) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/entries/latest", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry_type: latest.entry_type, id: latest.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? "No se pudo revertir el registro");
      setConfirming(false);
      const next = await fetch("/api/entries/latest");
      setLatest(next.ok ? await next.json() as Latest | null : null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo revertir el registro");
    } finally { setBusy(false); }
  }

  return <div className={floating ? "undo-latest undo-floating" : "undo-latest"}>
    <button type="button" className={floating ? "floating-undo" : "undo-trigger"} disabled={!latest || busy} aria-label="Deshacer último registro" title="Deshacer último registro" onClick={() => { setConfirming(true); setError(""); }}>
      {floating ? "↶" : "↶ Deshacer último registro"}
    </button>
    {!floating && !latest && !error && <small>Aún no hay registros nuevos para deshacer.</small>}
    {error && <p className="error" role="alert">{error}</p>}
    {confirming && latest && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setConfirming(false); }}>
      <div className="undo-dialog" role="dialog" aria-modal="true" aria-labelledby="undo-title">
        <h2 id="undo-title">¿Revertir este registro?</h2>
        <p>Se eliminará el último {latest.entry_type === "debt" ? "registro de deuda" : latest.entry_type === "payment" ? "abono de deuda" : "movimiento"} ingresado:</p>
        <div className="undo-detail"><strong>{latest.label}</strong><span>{latest.occurred_on}</span><b>{money(latest.amount)}</b></div>
        <p>Esta acción no se puede recuperar.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="wizard-actions"><button className="button-quiet" type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancelar</button>
          <button className="button-danger" type="button" disabled={busy} onClick={remove}>{busy ? "Revirtiendo…" : "Sí, revertir"}</button></div>
      </div>
    </div>}
  </div>;
}
