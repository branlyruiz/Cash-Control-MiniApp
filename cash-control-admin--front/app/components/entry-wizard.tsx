"use client";

import { useEffect, useState } from "react";
import { firstDayAfter, money, todayInBogota } from "@/lib/format";
import type { Account, Categories, EntryType } from "@/lib/types";

const stepNames = ["Tipo", "Fecha", "Cuenta", "Categoría", "Valor", "Descripción", "Resumen"];
const typeLabels: Record<EntryType, string> = {
  income: "Ingreso habitual", variable: "Gasto variable", fixed: "Gasto fijo",
  payable: "Nueva deuda en contra", payable_payment: "Abono a deuda en contra",
  receivable: "Deuda a favor", receivable_new: "Nueva deuda a favor", transfer: "Transferencia",
};
type MainType = "income" | "expense" | "payable" | "receivable_new" | "transfer";

export default function EntryWizard({ categories, baselinePeriod, onSaved, onCancel, initialType = "variable", lockType = false, paymentMode = false }: {
  categories: Categories;
  baselinePeriod: string | null;
  onSaved: (date: string) => void;
  onCancel?: () => void;
  initialType?: EntryType;
  lockType?: boolean;
  paymentMode?: boolean;
}) {
  const firstEditableDay = firstDayAfter(baselinePeriod);
  const today = todayInBogota();
  const [step, setStep] = useState(lockType ? 1 : 0);
  const [mainType, setMainType] = useState<MainType | null>(lockType ? initialType === "income" || initialType === "receivable" ? "income" : initialType === "fixed" || initialType === "variable" || initialType === "payable_payment" || paymentMode ? "expense" : initialType === "payable" ? "payable" : "receivable_new" : null);
  const [entryType, setEntryType] = useState<EntryType>(initialType);
  const [date, setDate] = useState(firstEditableDay && firstEditableDay > today ? firstEditableDay : today);
  const [account, setAccount] = useState<Account>("digital");
  const [category, setCategory] = useState(initialType === "payable_payment" || initialType === "payable" && paymentMode ? categories.payable[0] ?? "" : initialType === "receivable" ? categories.receivable[0] ?? "" : initialType === "payable" || initialType === "receivable_new" ? "" : categories[initialType === "transfer" ? "variable" : initialType][0] ?? "");
  const [balances, setBalances] = useState<{ payable: Record<string, number>; receivable: Record<string, number> } | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [newCategory, setNewCategory] = useState(false);
  const [incomeSource, setIncomeSource] = useState<"income" | "receivable">("income");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const isDebt = entryType === "payable" && !paymentMode || entryType === "receivable_new";
  const payablePayment = entryType === "payable_payment" || paymentMode && entryType === "payable";
  const receivablePayment = entryType === "receivable" || entryType === "income" && incomeSource === "receivable" && !newCategory;
  const isPayment = payablePayment || receivablePayment;
  const isTransfer = entryType === "transfer";
  const categoryOptions = payablePayment ? categories.payable : entryType === "receivable" ? categories.receivable : receivablePayment ? Object.keys(balances?.receivable ?? {}) : !isDebt && !isTransfer ? categories[entryType as "income" | "fixed" | "variable"] : [];
  const creatingCategory = !isPayment && (newCategory || (!isDebt && !isTransfer && categoryOptions.length === 0));
  const visibleSteps = lockType ? stepNames.slice(1) : stepNames;
  const displayStep = lockType ? step - 1 : step;

  useEffect(() => {
    if (step < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const controller = new AbortController();
    setBalanceLoading(true);
    fetch(`/api/debt-balances?on=${encodeURIComponent(date)}`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("No se pudieron cargar las deudas"); return response.json(); })
      .then(value => {
        setBalances(value);
        if (entryType === "receivable" || payablePayment) {
          const options = value[payablePayment ? "payable" : "receivable"] as Record<string, number>;
          setCategory(current => options[current] > 0 ? current : Object.keys(options)[0] ?? "");
        }
        setError("");
      })
      .catch(cause => { if (cause.name !== "AbortError") setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setBalanceLoading(false); });
    return () => controller.abort();
  }, [date, step]);

  const pending = balances?.[payablePayment ? "payable" : "receivable"] ?? {};
  const pendingConcepts = Object.entries(pending).sort(([a], [b]) => a.localeCompare(b, "es"));
  const subtypes: EntryType[] = mainType === "income" ? ["income", "receivable"] : ["variable", "fixed", "payable_payment"];

  function chooseType(value: EntryType) {
    setEntryType(value);
    setCategory(value === "transfer" ? "Transferencia" : value === "payable_payment" ? categories.payable[0] ?? "" : value === "receivable" ? categories.receivable[0] ?? "" : value === "payable" || value === "receivable_new" ? "" : categories[value][0] ?? "");
    setNewCategory(false);
    setIncomeSource("income");
    setError("");
  }

  function validStep(): boolean {
    if (step === 0 && !mainType) {
      setError("Elige primero Ingresos, Gastos u otro tipo de registro.");
      return false;
    }
    if (step === 1 && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (firstEditableDay && date < firstEditableDay))) {
      setError(firstEditableDay ? `Elige una fecha desde ${firstEditableDay}.` : "Elige una fecha válida.");
      return false;
    }
    if (step === 3 && !isTransfer && !category.trim()) {
      setError("Selecciona o escribe una categoría.");
      return false;
    }
    if (step === 2 && entryType === "receivable" && (!balances || balanceLoading || !pendingConcepts.length)) {
      setError("No hay deudas a favor con saldo pendiente para esta fecha.");
      return false;
    }
    if (step === 3 && isPayment && (!(category in (balances?.[payablePayment ? "payable" : "receivable"] ?? {})) || pending[category] <= 0)) {
      setError("Selecciona una deuda con saldo pendiente para esta fecha.");
      return false;
    }
    if (step === 3 && creatingCategory && !isDebt && !isTransfer) {
      if (category.trim().length > 80) {
        setError("Escribe un nombre de hasta 80 caracteres.");
        return false;
      }
      if (categoryOptions.some(item => item.toLocaleLowerCase("es-CO") === category.trim().toLocaleLowerCase("es-CO"))) {
        setError("Esa categoría ya existe. Selecciónala en la lista.");
        return false;
      }
    }
    if (step === 4 && (!Number.isInteger(Number(amount)) || Number(amount) <= 0)) {
      setError("Escribe un valor entero mayor que cero.");
      return false;
    }
    if (step === 4 && isPayment && Number(amount) > pending[category]) {
      setError(`El abono supera el saldo pendiente de ${money(pending[category])}.`);
      return false;
    }
    setError("");
    return true;
  }

  function next() {
    if (validStep()) setStep(current => Math.min(current + 1, stepNames.length - 1));
  }

  async function save() {
    setSaving(true); setError("");
    const payload = isPayment
      ? { occurred_on: date, direction: payablePayment ? "payable" : "receivable", concept: category.trim(),
          account, description: description.trim(), amount: Number(amount) }
      : isDebt
      ? { occurred_on: date, direction: entryType === "receivable_new" ? "receivable" : "payable", concept: category.trim(), description: description.trim(), amount: Number(amount) }
      : {
          occurred_on: date,
          kind: isTransfer ? "transfer" : entryType === "income" ? "income" : "expense",
          account,
          target_account: isTransfer ? account === "digital" ? "cash" : "digital" : null,
          category: isTransfer ? "Transferencia" : category,
          create_category: creatingCategory && !isTransfer,
          expense_class: entryType === "fixed" || entryType === "variable" ? entryType : null,
          description: description.trim(), amount: Number(amount),
        };
    try {
      const response = await fetch(isPayment ? "/api/debt-payments" : isDebt ? "/api/debts" : "/api/transactions", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(typeof data.detail === "string" ? data.detail : "No se pudo guardar el registro");
      }
      onSaved(date);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar el registro");
    } finally { setSaving(false); }
  }

  return <div className="wizard">
    <div className="wizard-progress" aria-label={`Paso ${step + 1} de ${stepNames.length}`}>
      {visibleSteps.map((name, index) => <span key={name} className={index <= displayStep ? "is-active" : ""} title={name} />)}
    </div>
    <p className="wizard-counter">Paso {displayStep + 1} de {visibleSteps.length} · {stepNames[step]}</p>
    <div className="wizard-step" key={step}>
      {step === 0 && <><h2>¿Qué vas a registrar?</h2><p>Elige la categoría principal.</p><div className="choice-grid">
        {(["income", "expense", "payable", "receivable_new", "transfer"] as MainType[]).map(type => <button type="button" key={type}
          className={mainType === type ? "choice selected" : "choice"} aria-pressed={mainType === type}
          onClick={() => { setMainType(type); chooseType(type === "expense" ? "variable" : type); }}>
          {{ income: "Ingresos", expense: "Gastos", payable: "Nueva deuda en contra", receivable_new: "Nueva deuda a favor", transfer: "Transferencia" }[type]}</button>)}
      </div>{(mainType === "income" || mainType === "expense") && <><p className="field-note">{mainType === "income" ? "Subcategoría de ingresos" : "Subcategoría de gastos"}</p><div className="choice-grid">
        {subtypes.map(type => <button type="button" key={type}
          className={entryType === type ? "choice selected" : "choice"} aria-pressed={entryType === type}
          onClick={() => chooseType(type)}>{typeLabels[type]}</button>)}
      </div></>}</>}
      {step === 1 && <><h2>¿En qué fecha?</h2><p>Indica cuándo ocurrió el movimiento, el abono o se creó la deuda.</p>
        <label className="field">Fecha<input autoFocus type="date" value={date} min={firstEditableDay ?? undefined} onChange={event => setDate(event.target.value)} /></label>
        {firstEditableDay && <p className="field-note">El historial importado ya cubre los meses anteriores a {firstEditableDay}.</p>}
      </>}
      {step === 2 && <><h2>¿En qué cuenta?</h2>{isDebt && !payablePayment
        ? <div className="info-tile"><strong>Sin cuenta</strong><p>Crear una deuda no cambia tu dinero disponible. El pago se registra cuando ocurra.</p></div>
        : <><p>{isTransfer ? "Selecciona la cuenta desde la que sale el dinero." : payablePayment ? "Selecciona de qué cuenta sale el abono." : receivablePayment ? "Selecciona la deuda que te pagaron y la cuenta que recibió el dinero." : "Selecciona dónde se mueve el dinero."}</p>
          {entryType === "receivable" && <label className="field">Deuda a favor
            <select value={category} onChange={event => setCategory(event.target.value)}>
              {pendingConcepts.map(([concept, balance]) => <option key={concept} value={concept}>{concept} · Pendiente {money(balance)}</option>)}
            </select>
          </label>}
          {entryType === "receivable" && !balanceLoading && !pendingConcepts.length && <p className="field-note">No hay deudas a favor pendientes para esta fecha.</p>}
          <div className="choice-grid two"><button type="button" className={account === "digital" ? "choice selected" : "choice"} onClick={() => setAccount("digital")}>Digital</button>
            <button type="button" className={account === "cash" ? "choice selected" : "choice"} onClick={() => setAccount("cash")}>Efectivo</button></div>
          {isTransfer && <p className="field-note">Destino: {account === "digital" ? "efectivo" : "digital"}.</p>}</>}
      </>}
      {step === 3 && <><h2>{isDebt || isPayment ? "¿Cuál es el concepto?" : "¿Qué categoría corresponde?"}</h2>
        {isTransfer ? <div className="info-tile"><strong>Transferencia</strong><p>Se moverá dinero entre las dos cuentas.</p></div>
          : entryType === "receivable" ? <div className="info-tile"><strong>{category}</strong><p>Ingreso de una deuda a favor. Pendiente: {money(pending[category] ?? 0)}.</p></div>
          : payablePayment ? <><p>Selecciona la deuda a la que abonarás.</p><label className="field">Deuda en contra
            <select autoFocus value={category} onChange={event => setCategory(event.target.value)}>
              {pendingConcepts.map(([concept, balance]) => <option key={concept} value={concept}>{concept} · Pendiente {money(balance)}</option>)}
            </select></label>{!balanceLoading && !pendingConcepts.length && <p className="field-note">No hay deudas en contra pendientes para esta fecha.</p>}</>
          : isDebt ? <><p>Elige un concepto anterior o escribe uno nuevo. Si es nuevo, se guardará al confirmar.</p><label className="field">Concepto
            <input autoFocus value={category} maxLength={80} list={`debt-concepts-${entryType}`}
              onChange={event => setCategory(event.target.value)} placeholder="Ej. préstamo a un amigo" />
            <datalist id={`debt-concepts-${entryType}`}>{categories[entryType === "receivable_new" ? "receivable" : "payable"].map(item => <option key={item} value={item} />)}</datalist>
          </label></> : <><p>Elige una categoría de {typeLabels[entryType].toLowerCase()} o crea una nueva.</p>
            {entryType === "income" && <div className="choice-grid two" aria-label="Subcategoría de ingresos">
              <button type="button" className={incomeSource === "income" ? "choice selected" : "choice"} onClick={() => { setIncomeSource("income"); setNewCategory(false); setCategory(categories.income[0] ?? ""); }}>Ingreso habitual</button>
              <button type="button" className={incomeSource === "receivable" ? "choice selected" : "choice"} onClick={() => { setIncomeSource("receivable"); setNewCategory(false); setCategory(Object.keys(balances?.receivable ?? {})[0] ?? ""); }}>Deuda a favor</button>
            </div>}
            {creatingCategory ? <label className="field">Nueva categoría
              <input autoFocus value={category} maxLength={80} onChange={event => setCategory(event.target.value)} placeholder="Escribe el nombre" />
            </label> : <label className="field">Categoría
              <select autoFocus value={category} onChange={event => setCategory(event.target.value)}>
                {categoryOptions.map(item => <option key={item} value={item}>{item}{receivablePayment ? ` · Pendiente ${money(balances?.receivable[item] ?? 0)}` : ""}</option>)}
              </select></label>}
            {categoryOptions.length > 0 && !receivablePayment && <button type="button" className="new-category-toggle" onClick={() => { setNewCategory(value => !value); setCategory(newCategory ? categoryOptions[0] ?? "" : ""); setError(""); }}>
              {newCategory ? "← Elegir categoría existente" : "+ Crear categoría nueva"}
            </button>}
            {creatingCategory && <p className="field-note">La categoría se guardará junto con este valor al aceptar el resumen.</p>}</>}
      </>}
      {step === 4 && <><h2>¿Cuál es el valor?</h2><p>Ingresa pesos colombianos, sin decimales.</p>
        <label className="field">Valor en pesos<input autoFocus type="number" min="1" step="1" inputMode="numeric"
          value={amount} onChange={event => setAmount(event.target.value)} placeholder="50000" /></label></>}
      {step === 5 && <><h2>Agrega una descripción</h2><p>Este paso es opcional.</p>
        <label className="field">Descripción<textarea autoFocus rows={4} maxLength={300} value={description}
          onChange={event => setDescription(event.target.value)} placeholder="Detalle del movimiento" /></label></>}
      {step === 6 && <><h2>Revisa el registro</h2><p>Confirma los datos antes de guardarlos.</p><dl className="review-list">
        <div><dt>Tipo</dt><dd>{payablePayment ? "Abono a deuda en contra" : receivablePayment ? "Ingreso de deuda a favor" : typeLabels[entryType]}</dd></div>
        <div><dt>Fecha</dt><dd>{date}</dd></div>
        <div><dt>Cuenta</dt><dd>{isDebt && !payablePayment ? "Sin cuenta" : isTransfer ? `${account === "digital" ? "Digital" : "Efectivo"} → ${account === "digital" ? "Efectivo" : "Digital"}` : account === "digital" ? "Digital" : "Efectivo"}</dd></div>
        <div><dt>{isDebt || isPayment ? "Concepto" : "Categoría"}</dt><dd>{category}{creatingCategory && !isDebt ? " · Nueva" : ""}</dd></div>
        <div><dt>Valor</dt><dd>{money(Number(amount))}</dd></div>
        <div><dt>Descripción</dt><dd>{description.trim() || "Sin descripción"}</dd></div>
      </dl>{isPayment ? <p className="field-note">El abono {payablePayment ? "descontará dinero de la cuenta y reducirá la deuda" : "sumará dinero a la cuenta y reducirá lo pendiente por cobrar"}.</p>
        : isDebt && <p className="field-note">Esta deuda no modificará el dinero disponible.</p>}</>}
    </div>
    {error && <p className="error wizard-error" role="alert">{error}</p>}
    <div className="wizard-actions">
      {step > (lockType ? 1 : 0) ? <button type="button" className="button-quiet" onClick={() => { setStep(step - 1); setError(""); }} disabled={saving}>Atrás</button>
        : onCancel ? <button type="button" className="button-quiet" onClick={onCancel}>Cancelar</button> : <span />}
      {step < stepNames.length - 1 ? <button type="button" className="button-primary" onClick={next}>Continuar</button>
        : <button type="button" className="button-primary" disabled={saving} onClick={save}>{saving ? "Guardando…" : "Aceptar y guardar"}</button>}
    </div>
  </div>;
}
