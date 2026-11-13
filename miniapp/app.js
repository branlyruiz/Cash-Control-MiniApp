"use strict";
(function(){
const UI=globalThis.CashUI;
const START="2026-11-01", FIRST_MONTH="2026-11", DB_NAME="BR_CASH_CONTROL_LOCAL_V1";
const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(Number(n)||0);
const niceDate=(s,short=false)=>new Intl.DateTimeFormat("es-CO",{day:"numeric",month:"short",year:short?undefined:"numeric",timeZone:"UTC"}).format(new Date(s+"T12:00:00Z"));
const monthText=s=>new Intl.DateTimeFormat("es-CO",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(s+"-01T12:00:00Z"));
const nowBogota=()=>{const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Bogota",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const part=type=>parts.find(x=>x.type===type)?.value||"";return `${part("year")}-${part("month")}-${part("day")}`};
const safe=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid=()=>typeof crypto!=="undefined"&&crypto.randomUUID?crypto.randomUUID():"br-"+Date.now()+"-"+Math.random().toString(36).slice(2);
let db,entries=[],view="dashboard",month=FIRST_MONTH,editing=null,toastTimer=null,selectedDebt=null,formSubmitting=false,debtPaymentState=null,debtPaymentSaving=false,debtPaymentInitial="";
const kinds={income:"Ingreso",expense:"Gasto",transfer:"Transferencia",debt:"Deuda",payment:"Abono"};
const accountNames={digital:"Digital",cash:"Efectivo"};

const DEFAULT_VARIABLE_CATEGORIES=["VARIOS","COMIDA CHATARRA","MASCOTAS","ASEO CASA","ALMUERZOS - CENA","CICLISMO","BRUNCH","MOTOCICLETA","PELUQUERIA","PAREJA","INTERVALS","BATERÍAS","OPERATIVOS FOTO","GAMING APPS"];
const CATEGORY_SEED_ID="variable-category-seed-2026-11";
function categoryKey(label){return String(label||"").trim().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("es-CO")}
function variableCategoryNames(){return [...new Set(entries.filter(x=>x.kind==="category_variable"||x.kind==="expense"&&x.expenseClass!=="fixed").map(x=>x.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"es-CO"))}
async function seedVariableCategories(){
 const current=await allEntries();
 if(current.some(x=>x.id===CATEGORY_SEED_ID))return;
 const known=new Set(current.filter(x=>x.kind==="expense"&&x.expenseClass!=="fixed"||x.kind==="category_variable").map(x=>categoryKey(x.category)));
 const created=new Date().toISOString();
 await transaction("readwrite",store=>{
  store.put({id:CATEGORY_SEED_ID,kind:"category_seed",date:START,created,account:"digital",category:"",description:"",amount:0});
  DEFAULT_VARIABLE_CATEGORIES.forEach((category,index)=>{
   if(!known.has(categoryKey(category)))store.put({id:"variable-category-default-"+index,kind:"category_variable",date:START,created,account:"digital",category,description:"",amount:0});
  });
 });
}

function showToast(msg){if(UI){UI.toast(msg);return}const el=$("toast");el.textContent=msg;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),3000)}
function openDB(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>{const d=request.result;if(!d.objectStoreNames.contains("entries")){const store=d.createObjectStore("entries",{keyPath:"id"});store.createIndex("date","date")}};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
function transaction(mode,fn){return new Promise((resolve,reject)=>{const tx=db.transaction("entries",mode),store=tx.objectStore("entries");let result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("Transacción cancelada"));try{result=fn(store,tx)}catch(e){tx.abort();reject(e)}})}
function allEntries(){return new Promise((resolve,reject)=>{const req=db.transaction("entries").objectStore("entries").getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function refresh(){entries=(await allEntries()).sort((a,b)=>b.date.localeCompare(a.date)||b.created.localeCompare(a.created));render()}
const isMoney=o=>["income","expense","transfer","payment"].includes(o.kind);
const paidTo=(id,until)=>entries.filter(x=>x.kind==="payment"&&x.debtId===id&&(!until||x.date<=until)).reduce((s,x)=>s+x.amount,0);
function debtBalance(d,until){return Math.max(0,d.amount-paidTo(d.id,until))}
function debtsAvailable(onDate,excludePaymentId=null){return entries.filter(x=>x.kind==="debt"&&x.date<=onDate).map(d=>({entry:d,remaining:d.amount-entries.filter(p=>p.kind==="payment"&&p.debtId===d.id&&p.id!==excludePaymentId).reduce((s,p)=>s+p.amount,0)})).filter(d=>d.remaining>0)}
function accountBalance(until){const balances={digital:0,cash:0};for(const x of entries){if(x.date>until)continue;if(x.kind==="income")balances[x.account]+=x.amount;else if(x.kind==="expense")balances[x.account]-=x.amount;else if(x.kind==="transfer"){balances[x.account]-=x.amount;balances[x.target]+=x.amount}else if(x.kind==="payment"){const d=entries.find(q=>q.id===x.debtId);if(d&&d.direction==="receivable")balances[x.account]+=x.amount;else balances[x.account]-=x.amount}}return balances}
function recordTitle(x){if(x.kind==="debt")return x.category||"Deuda";if(x.kind==="payment"){const d=entries.find(q=>q.id===x.debtId);return "Abono · "+(d?.category||"Deuda")}if(x.kind==="transfer")return "Digital ↔ Efectivo";return x.category||kinds[x.kind]||"Movimiento"}
function amountClass(x){return x.kind==="income"?"positive":x.kind==="expense"?"negative":x.kind==="payment"?(entries.find(q=>q.id===x.debtId)?.direction==="receivable"?"positive":"negative"):""}
function amountPrefix(x){return x.kind==="income"?"+":x.kind==="expense"?"−":x.kind==="payment"?(amountClass(x)==="positive"?"+":"−"):""}
function summary(){const until=month+"-31",balances=accountBalance(until),monthly=entries.filter(x=>x.date.slice(0,7)===month);
const income=monthly.reduce((s,x)=>s+(x.kind==="income"?x.amount:x.kind==="payment"&&amountClass(x)==="positive"?x.amount:0),0);
const expenses=monthly.reduce((s,x)=>s+(x.kind==="expense"?x.amount:x.kind==="payment"&&amountClass(x)==="negative"?x.amount:0),0);
const groups={};for(const x of monthly){if(x.kind==="expense")groups[x.category||"Sin categoría"]=(groups[x.category||"Sin categoría"]||0)+x.amount}
return {until,balances,income,expenses,monthly,groups}}
function entryHtml(x,buttons=true){
 const icon={income:"income",expense:"expense",transfer:"transfer",debt:"debt",payment:"payment"}[x.kind];
 const cls=x.kind==="debt"?x.direction:x.kind;
 const row='<button type="button" class="transaction" data-detail="'+safe(x.id)+'" aria-label="Ver '+safe(recordTitle(x))+', '+safe(amountPrefix(x)+money(x.amount))+'"><span class="transaction-icon '+safe(cls)+'" data-icon="'+icon+'" aria-hidden="true"></span><span class="transaction-main"><strong class="transaction-name">'+safe(recordTitle(x))+'</strong><span class="transaction-date">'+niceDate(x.date,true)+' · '+safe(accountNames[x.account])+'</span></span><span class="transaction-amount '+amountClass(x)+'">'+amountPrefix(x)+money(x.amount)+'</span></button>';
 return buttons?'<div class="transaction-swipe"><div class="quick-actions" inert><button type="button" class="small-action" data-edit="'+safe(x.id)+'">Editar</button><button type="button" class="small-action danger" data-delete="'+safe(x.id)+'">Eliminar</button></div>'+row+'</div>':row;
}
function renderMovementDetail(id){
 const x=entries.find(x=>x.id===id),el=$("movementDetail");
 if(!x){el.innerHTML=empty("Este movimiento ya no está disponible.");return}
 el.innerHTML='<div class="detail-hero"><span class="transaction-icon '+safe(x.kind)+'">'+(UI?.icon(x.kind)||'')+'</span><h3>'+safe(recordTitle(x))+'</h3><strong class="detail-amount '+amountClass(x)+'">'+amountPrefix(x)+money(x.amount)+'</strong><span class="detail-tag">'+safe(kinds[x.kind])+(x.kind==="expense"?' · '+(x.expenseClass==="fixed"?'Gasto fijo':'Gasto variable'):'')+'</span></div><section class="panel summary-lines">'+
 [['Fecha',niceDate(x.date)],['Cuenta',accountNames[x.account]],...(x.kind==="transfer"?[['Destino',accountNames[x.target]]]:[]),['Concepto',recordTitle(x)],['Nota',x.description||'Sin nota']].map(([label,value])=>'<div class="balance-line"><span>'+safe(label)+'</span><strong>'+safe(value)+'</strong></div>').join('')+'</section><div class="detail-actions"><button type="button" class="save-btn" data-edit="'+safe(id)+'">Editar</button><button type="button" class="small-action danger" data-delete="'+safe(id)+'">Eliminar</button></div>';
}

function empty(message){return '<div class="empty-small">'+safe(message)+'</div>'}
function render(){UI?.beforeRender();const s=summary();$("periodLabel").textContent=monthText(month);$("balanceMonth").textContent=monthText(month);$("totalBalance").textContent=money(s.balances.digital+s.balances.cash);$("digitalBalance").textContent=money(s.balances.digital);$("cashBalance").textContent=money(s.balances.cash);$("incomeTotal").textContent=money(s.income);$("expenseTotal").textContent=money(s.monthly.filter(x=>x.kind==="expense"&&x.expenseClass!=="fixed").reduce((sum,x)=>sum+x.amount,0));$("prevMonth").disabled=month<=FIRST_MONTH;
const activity=s.monthly.filter(isMoney);$("recentTransactions").innerHTML=activity.length?activity.slice(0,5).map(x=>entryHtml(x,false)).join(""):empty("Aún no tienes movimientos en "+monthText(month)+".");
const filter=$("filterKind").value;const selected=activity.filter(x=>filter==="all"||x.kind===filter||(x.kind==="expense"&&x.expenseClass===filter));const query=($("movementSearch")?.value||"").trim().toLocaleLowerCase("es-CO"),visible=selected.filter(x=>(recordTitle(x)+" "+x.description).toLocaleLowerCase("es-CO").includes(query));$("allTransactions").innerHTML=visible.length?visible.map(x=>entryHtml(x)).join(""):empty("No hay movimientos para este filtro en "+monthText(month)+".");
renderDebtLists(s.until);
$("payableHome").textContent=$("payableTotal").textContent;
 enhancedRender(s);
 $("outflowTotal").textContent=money(s.expenses);
 UI?.afterRender();
}
function debtRows(direction,until=month+"-31",settled=false){
 return entries.filter(d=>d.kind==="debt"&&(!direction||d.direction===direction)&&d.date<=until)
  .map(d=>({entry:d,remaining:debtBalance(d,until)})).filter(x=>settled?x.remaining===0:x.remaining>0)
  .sort((a,b)=>b.remaining-a.remaining||a.entry.category.localeCompare(b.entry.category,"es-CO")||a.entry.id.localeCompare(b.entry.id));
}
function debtRowHtml({entry:d,remaining}){
 const initial=Array.from((d.category||"D").trim())[0]||"D",canPay=d.amount-pendingDebtPayments(d.id)>0;
 return '<article class="debt-receivable-row debt-tone-'+safe(d.direction)+'"><span class="debt-avatar" aria-hidden="true">'+safe(initial.toUpperCase())+'</span><button type="button" class="debt-identity" data-edit="'+safe(d.id)+'" aria-label="Editar deuda '+safe(d.category)+'"><strong>'+safe(d.category)+'</strong><span>'+safe(d.description||"Desde "+niceDate(d.date))+'</span></button><strong class="debt-row-amount">'+money(remaining)+'</strong>'+(remaining>0?'<button type="button" class="debt-pay-add" data-pay="'+safe(d.id)+'" aria-label="Registrar abono de '+safe(d.category)+'" '+(!canPay?'disabled title="Esta deuda ya tiene su saldo cubierto en otro período"':"")+'><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>':'<span class="debt-paid-mark" aria-label="Saldada">✓</span>')+'</article>';
}
function renderDebtLists(until){
 for(const [direction,listId,totalId] of [["receivable","receivableList","receivableTotal"],["payable","payableList","payableTotal"]]){
  const rows=debtRows(direction,until);
  $(totalId).textContent=money(rows.reduce((sum,x)=>sum+x.remaining,0));
  $(listId).innerHTML=rows.length?rows.map(debtRowHtml).join(""):empty(direction==="receivable"?"No tienes deudas por cobrar.":"No tienes deudas por pagar.");
 }
 const settled=debtRows(null,until,true);
 $("settledDebts").classList.toggle("hidden",!settled.length);
 $("settledDebtCount").textContent=String(settled.length);
 $("settledDebtList").innerHTML=settled.map(debtRowHtml).join("");
}
function debtPaymentRemaining(){
 const d=entries.find(x=>x.kind==="debt"&&x.id===debtPaymentState?.debtId);
 return d?Math.max(0,d.amount-pendingDebtPayments(d.id,debtPaymentState.original?.id)):0;
}
function debtPaymentDraft(){return JSON.stringify([$("debtPaymentAmount").value,$("debtPaymentDate").value,$("debtPaymentAccount").value,$("debtPaymentNote").value])}
function syncDirectPayment(){
 if(!debtPaymentState)return;
 const d=entries.find(x=>x.id===debtPaymentState.debtId),remaining=debtPaymentRemaining(),amount=Number($("debtPaymentAmount").value)||0;
 $("debtPaymentBalance").textContent=money(remaining);$("debtPaymentAmount").max=String(remaining);
 $("debtPaymentAfter").textContent=money(Math.max(0,remaining-amount));
 $("debtPaymentAfter").classList.toggle("negative",amount>remaining);
 const destination=$("debtPaymentAccount").value==="cash"?"tu efectivo":"tu cuenta digital";
 $("debtPaymentEffect").textContent=(d?.direction==="payable"?"El abono se descontará de ":"El abono se sumará a ")+destination+".";
}
function openDebtPayment(id,original=null,full=false){
 const d=entries.find(x=>x.kind==="debt"&&x.id===id);if(!d)return;
 const remaining=d.amount-pendingDebtPayments(id,original?.id);
 if(remaining<=0){showToast("Esta deuda ya está saldada.");return}
 if($("entryDialog").open)closeEntry();$("conceptDialog").close();
 debtPaymentState={debtId:id,original};$("debtPaymentForm").reset();
 $("debtPaymentDialog").classList.toggle("is-payable",d.direction==="payable");
 $("debtPaymentTitle").textContent=d.category;$("debtPaymentSubtitle").textContent=d.description|| (d.direction==="payable"?"Deuda en contra · Por pagar":"Deuda a favor · Por cobrar");
 $("debtPaymentEyebrow").textContent=original?"EDITAR ABONO":"REGISTRAR ABONO";
 $("debtPaymentAmount").value=original?.amount||"";$("debtPaymentDate").value=original?.date||(nowBogota()<START?START:nowBogota());
 $("debtPaymentAccount").value=original?.account||"digital";$("debtPaymentNote").value=original?.description||"";
 $("debtPaymentError").textContent="";$("saveDebtPayment").disabled=false;
 $("saveDebtPayment").textContent=original?"Guardar cambios":"Guardar abono";
 debtPaymentInitial=debtPaymentDraft();if(full)$("debtPaymentAmount").value=String(remaining);
 syncDirectPayment();$("debtPaymentDialog").showModal();$("debtPaymentAmount").focus({preventScroll:true});
}
function closeDebtPayment(force=false){
 if(!force&&(debtPaymentSaving||debtPaymentDraft()!==debtPaymentInitial&&!confirm("¿Salir sin guardar el abono?")))return;
 if($("debtPaymentDialog").contains(document.activeElement))document.activeElement.blur();
 $("debtPaymentDialog").close();debtPaymentState=null;
}
async function saveDebtPayment(event){
 event.preventDefault();if(debtPaymentSaving||!debtPaymentState)return;
 const original=debtPaymentState.original,x={id:original?.id||uid(),created:original?.created||new Date().toISOString(),kind:"payment",amount:Number($("debtPaymentAmount").value),date:$("debtPaymentDate").value,account:$("debtPaymentAccount").value,category:"",description:$("debtPaymentNote").value.trim(),expenseClass:null,direction:null,target:null,debtId:debtPaymentState.debtId};
 const error=validEntry(x,original);$("debtPaymentError").textContent=error;
 if(error){$("debtPaymentAmount").focus({preventScroll:true});return}
 debtPaymentSaving=true;$("saveDebtPayment").disabled=true;UI?.saving("debtPaymentForm",true);
 try{
  await transaction("readwrite",store=>store.put(x));closeDebtPayment(true);await refresh();
  const d=entries.find(d=>d.id===x.debtId);
  showToast(d&&debtBalance(d)===0?"Deuda saldada. Disponible actualizado.":original?"Abono actualizado.":"Abono registrado. Disponible actualizado.");
 }catch(err){$("debtPaymentError").textContent="No se pudo guardar: "+err.message}
 finally{UI?.saving("debtPaymentForm",false);debtPaymentSaving=false;$("saveDebtPayment").disabled=false}
}
function openMoreSheet(){navigate("more")}
function closeMoreSheet(){}
function navigate(name){view=name;UI?.navigate(name)}

function moveMonth(shift){const [y,m]=month.split("-").map(Number);const d=new Date(Date.UTC(y,m-1+shift,1));const target=d.toISOString().slice(0,7);if(target>=FIRST_MONTH){month=target;render()}}
function addOptions(){
 const kind=$("entryKind").value,expenseClass=$("expenseClass").value;
 const categories=kind==="expense"&&expenseClass==="variable"?variableCategoryNames():kind==="expense"?[...new Set([...fixedPlans(month).map(x=>x.category),...entries.filter(x=>x.kind==="expense"&&x.expenseClass==="fixed").map(x=>x.category)])]:[...new Set(entries.filter(x=>x.kind==="income").map(x=>x.category))];
 $("categoriesList").innerHTML=categories.filter(Boolean).sort((a,b)=>a.localeCompare(b,"es-CO")).map(x=>'<option value="'+safe(x)+'">').join("");
 syncVariableCategoryPicker();
}
function syncVariableCategoryPicker(){
 const visible=$("entryKind").value==="expense"&&$("expenseClass").value==="variable";
 $("variablePickerField").classList.toggle("hidden",!visible);
 if(!visible){$("categoryField").classList.toggle("hidden",!["income","expense","debt"].includes($("entryKind").value));return}
 const categories=variableCategoryNames(),value=$("entryCategory").value;
 $("variableCategoryPicker").innerHTML='<option value="__choose__">Selecciona un concepto</option>'+categories.map(c=>'<option value="'+safe(c)+'">'+safe(c)+'</option>').join("")+'<option value="__new__">+ Crear nuevo concepto</option>';
 const known=categories.find(c=>categoryKey(c)===categoryKey(value));
 $("variableCategoryPicker").value=known||(value?"__new__":"__choose__");
 $("categoryField").classList.add("hidden");
}
function populateDebtOptions(exclude){
 const date=$("entryDate").value||nowBogota(),direction=$("entryDirection").value;
 const previous=$("entryDebt").value||selectedDebt;
 const list=debtsAvailable(date,exclude).filter(x=>x.entry.direction===direction);
 $("entryDebt").innerHTML='<option value="">Selecciona una deuda</option>'+list.map(({entry:d,remaining})=>'<option value="'+safe(d.id)+'">'+safe(d.category)+' · '+money(remaining)+'</option>').join("");
 $("entryDebt").value=previous&&list.some(x=>x.entry.id===previous)?previous:"";
 selectedDebt=$("entryDebt").value||null;
 syncDebtPayment();
}
function syncDebtPayment(){
 const kind=$("entryKind").value,isPayment=kind==="payment",settle=isPayment&&$("debtAction").value==="settle";
 $("amountPanel").classList.toggle("hidden",settle);
 $("entryAmount").disabled=settle;
 $("amountLabel").textContent=isPayment?"VALOR DEL ABONO · COP":"VALOR DEL MOVIMIENTO · COP";
 $("saveEntry").textContent=settle?"Confirmar pago total":isPayment?"Guardar abono":kind==="debt"?"Guardar deuda":"Guardar movimiento";
 const debt=entries.find(x=>x.kind==="debt"&&x.id===$("entryDebt").value);
 if(kind==="debt"){
  $("debtPaymentHint").textContent="Registra el saldo pendiente. El disponible cambia cuando pagas o cobras la deuda.";
 }else if(isPayment&&debt){
  const remaining=debt.amount-pendingDebtPayments(debt.id,editing?.id);
  const effect=debt.direction==="payable"?"se descontará de":"se sumará a",destination=$("entryAccount").value==="digital"?"tu cuenta digital":"tu efectivo";
  $("debtPaymentHint").textContent=(settle?"Pago total: ":"Saldo pendiente: ")+money(remaining)+". "+(settle?"Este valor":"El abono")+" "+effect+" "+destination+" al confirmar.";
 }else if(isPayment){
  $("debtPaymentHint").textContent="Selecciona una deuda pendiente. Si no aparece, revisa el tipo y la fecha o elige Registrar nueva deuda.";
 }else $("debtPaymentHint").textContent="";
}
function adjustForm(){
 const kind=$("entryKind").value,debtMode=kind==="debt"||kind==="payment";
 document.querySelectorAll("[data-entry-kind]").forEach(button=>{
  const active=button.dataset.entryKind===(debtMode?"debt":kind);
  button.classList.toggle("active",active);button.setAttribute("aria-pressed",String(active));
 });
 $("formEyebrow").textContent=editing?"CASH CONTROL · EDITAR REGISTRO":"CASH CONTROL · NUEVO REGISTRO";
 $("expenseClassField").classList.toggle("hidden",kind!=="expense");
 $("targetField").classList.toggle("hidden",kind!=="transfer");
 $("categoryField").classList.toggle("hidden",!["income","expense","debt"].includes(kind));
 $("debtControls").classList.toggle("hidden",!debtMode);
 $("debtField").classList.toggle("hidden",kind!=="payment");
 $("debtAction").disabled=editing?.kind==="debt";
 $("deleteEditingDebt").classList.toggle("hidden",editing?.kind!=="debt");
 $("accountField").classList.toggle("hidden",kind==="debt");
 if(kind==="payment")populateDebtOptions(editing?.kind==="payment"?editing.id:null);
 addOptions();syncDebtPayment();
 $("dialogTitle").textContent=editing?"Editar registro":debtMode?"Deuda":"Nuevo movimiento";
 $("formError").textContent="";
}
function openForm(kind="income",record=null,debtId=null,action="payment"){
 editing=record;selectedDebt=debtId||record?.debtId||null;
 $("entryForm").reset();$("entryKind").value=record?.kind||kind;
 $("debtAction").value=$("entryKind").value==="debt"?"new":action;
 $("entryAmount").value=record?.amount||"";
 $("entryDate").value=record?.date||(nowBogota()<START?START:nowBogota());
 $("entryAccount").value=record?.account||"digital";
 $("entryCategory").value=record?.category||"";$("expenseClass").value=record?.expenseClass||"variable";
 const debt=entries.find(x=>x.kind==="debt"&&x.id===selectedDebt);
 $("entryDirection").value=record?.direction||debt?.direction||(["payable","receivable"].includes(categoryKind)?categoryKind:"receivable");
 $("entryDebt").value="";$("entryDescription").value=record?.description||"";
 if(record?.target)$("entryTarget").value=record.target;
 $("saveEntry").disabled=false;adjustForm();$("entryDialog").showModal();
}
function closeEntry(){
 if($("entryDialog").contains(document.activeElement))document.activeElement.blur();
 $("entryDialog").close();
}
function pendingDebtPayments(id,exclude=null){return entries.filter(x=>x.kind==="payment"&&x.debtId===id&&x.id!==exclude).reduce((s,x)=>s+x.amount,0)}
function validEntry(x,original){if(!["income","expense","transfer","debt","payment"].includes(x.kind))return "Tipo de registro no válido.";if(!/^\d{4}-\d{2}-\d{2}$/.test(x.date)||x.date<START||!Number.isFinite(Date.parse(x.date+"T12:00:00Z")))return "La fecha debe ser desde el 1 de noviembre de 2026.";if(!Number.isSafeInteger(x.amount)||x.amount<=0)return "Introduce un importe entero mayor que cero.";if(!["digital","cash"].includes(x.account))return "Selecciona una cuenta válida.";if(["income","expense","debt"].includes(x.kind)&&!x.category)return "Indica la categoría o concepto.";if(x.kind==="expense"&&!["fixed","variable"].includes(x.expenseClass))return "Selecciona gasto fijo o variable.";if(x.kind==="transfer"&&(!["digital","cash"].includes(x.target)||x.account===x.target))return "La cuenta de destino debe ser diferente.";if(original?.kind==="debt"&&x.kind!=="debt"&&entries.some(p=>p.kind==="payment"&&p.debtId===original.id))return "No cambies el tipo de una deuda con abonos; elimina primero los abonos.";if(x.kind==="debt"){if(!["receivable","payable"].includes(x.direction))return "Selecciona el tipo de deuda.";if(original&&original.kind==="debt"){if(x.amount<pendingDebtPayments(x.id))return "La deuda no puede ser menor que los abonos registrados.";if(x.date>entries.filter(q=>q.kind==="payment"&&q.debtId===x.id).map(q=>q.date).sort()[0]&&entries.some(q=>q.kind==="payment"&&q.debtId===x.id))return "La fecha inicial no puede ser posterior a sus abonos."}}
if(x.kind==="payment"){const d=entries.find(q=>q.id===x.debtId&&q.kind==="debt");if(!d)return "Selecciona una deuda válida.";if(x.date<d.date)return "El abono no puede ser anterior a la deuda.";const paid=entries.filter(q=>q.kind==="payment"&&q.debtId===d.id&&q.id!==x.id).reduce((s,q)=>s+q.amount,0);if(x.amount>d.amount-paid)return "El abono supera el saldo pendiente ("+money(d.amount-paid)+").";}return ""}
async function saveForm(e){e.preventDefault();if(formSubmitting)return;const kind=$("entryKind").value;const x={id:editing?.id||uid(),created:editing?.created||new Date().toISOString(),kind,amount:Number($("entryAmount").value),date:$("entryDate").value,account:$("entryAccount").value,category:$("entryCategory").value.trim(),description:$("entryDescription").value.trim(),expenseClass:kind==="expense"?$("expenseClass").value:null,direction:kind==="debt"?$("entryDirection").value:null,target:kind==="transfer"?$("entryTarget").value:null,debtId:kind==="payment"?$("entryDebt").value:null};if(kind==="payment"&&$("debtAction").value==="settle"){
 const debt=entries.find(d=>d.kind==="debt"&&d.id===x.debtId);
 if(!debt){$("formError").textContent="Selecciona una deuda pendiente.";return}
 x.amount=debt.amount-pendingDebtPayments(debt.id,x.id);
}
const msg=validEntry(x,editing);if(msg){$("formError").textContent=msg;return}formSubmitting=true;$("saveEntry").disabled=true;UI?.saving("entryForm",true);try{
 const shouldCatalog=x.kind==="expense"&&x.expenseClass==="variable"&&!entries.some(c=>c.kind==="category_variable"&&categoryKey(c.category)===categoryKey(x.category));
 await transaction("readwrite",store=>{store.put(x);if(shouldCatalog)store.put({id:uid(),kind:"category_variable",date:START,created:new Date().toISOString(),account:"digital",category:x.category,description:"",amount:0})});
 closeEntry();await refresh();showToast(kind==="payment"&&$("debtAction").value==="settle"?"Deuda saldada. Disponible actualizado.":editing?"Registro actualizado.":"Registro guardado.");
}catch(err){$("formError").textContent="Error al guardar: "+err.message}finally{UI?.saving("entryForm",false);formSubmitting=false;$("saveEntry").disabled=false}}
async function removeEntry(id){const x=entries.find(q=>q.id===id);if(!x)return;if(x.kind==="debt"&&entries.some(q=>q.kind==="payment"&&q.debtId===id)){showToast("Elimina los abonos antes de borrar esta deuda.");return}if(!confirm("¿Eliminar este registro de "+money(x.amount)+"?"))return;try{await transaction("readwrite",store=>store.delete(id));await refresh();showToast("Registro eliminado.")}catch(e){showToast("No fue posible eliminar.")}}
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200)}
function exportBackup(){const payload={application:"Cash-Control-MiniApp",version:1,exportedAt:new Date().toISOString(),startDate:START,entries};download("CashControl_BR_"+nowBogota()+".json",JSON.stringify(payload,null,2),"application/json");showToast("Copia de seguridad exportada.")}
function exportCsv(){const h=["fecha","tipo","cuenta","destino","direccion_deuda","concepto","valor_COP","descripcion","id_deuda"];const quote=x=>'"'+String(x??"").replace(/"/g,'""')+'"';const lines=[h.join(";"),...entries.filter(x=>!["category_variable","category_seed","fixed_plan"].includes(x.kind)).map(x=>[x.date,x.kind,x.account,x.target,x.direction,x.category,x.amount,x.description,x.debtId].map(quote).join(";"))];download("CashControl_movimientos_"+nowBogota()+".csv","\ufeff"+lines.join("\r\n"),"text/csv;charset=utf-8");showToast("CSV exportado.")}
function validateBackup(p){if(!p||p.application!=="Cash-Control-MiniApp"||p.version!==1||!Array.isArray(p.entries)||p.entries.length>100000)throw Error("Archivo no compatible.");const seen=new Set();for(const e of p.entries){if(!e||typeof e.id!=="string"||seen.has(e.id)||typeof e.created!=="string"||typeof e.description!=="string"||typeof e.category!=="string"||!["income","expense","transfer","debt","payment","fixed_plan","category_variable","category_seed"].includes(e.kind)||!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||e.date<START||!Number.isSafeInteger(e.amount)||(["fixed_plan","category_variable","category_seed"].includes(e.kind)?e.amount<0:e.amount<=0)||!["digital","cash"].includes(e.account))throw Error("La copia tiene registros inválidos.");if(e.kind==="transfer"&&(!["digital","cash"].includes(e.target)||e.target===e.account))throw Error("Transferencia incorrecta.");if(e.kind==="fixed_plan"&&(!Number.isInteger(e.dueDay)||e.dueDay<1||e.dueDay>31))throw Error("Plan de gasto fijo incorrecto.");if(e.kind==="debt"&&!["receivable","payable"].includes(e.direction))throw Error("Dirección de deuda incorrecta.");seen.add(e.id)}for(const e of p.entries){if(e.kind==="payment"&&!p.entries.some(d=>d.kind==="debt"&&d.id===e.debtId&&d.date<=e.date))throw Error("Abono sin deuda válida.")}for(const d of p.entries.filter(e=>e.kind==="debt"))if(p.entries.filter(e=>e.kind==="payment"&&e.debtId===d.id).reduce((s,x)=>s+x.amount,0)>d.amount)throw Error("Abonos superiores a la deuda.")}
async function importBackup(file){try{if(!file)return;if(file.size>20*1024*1024)throw Error("Archivo demasiado grande.");const p=JSON.parse(await file.text());validateBackup(p);if(!confirm("¿Restaurar "+p.entries.length+" registros? Reemplazará TODOS los datos locales actuales. Exporta antes una copia si deseas conservarlos."))return;await transaction("readwrite",store=>{store.clear();for(const x of p.entries)store.put(x)});month=(nowBogota().slice(0,7) < FIRST_MONTH ? FIRST_MONTH : nowBogota().slice(0,7));await seedVariableCategories();await refresh();showToast("Copia restaurada correctamente.")}catch(e){showToast("No se restauró: "+e.message)}finally{$("backupFile").value=""}}
async function eraseAll(){if(!confirm("¿Eliminar TODOS los movimientos, deudas y abonos de ESTE dispositivo?"))return;if(!confirm("Confirmación final: los datos no se pueden recuperar sin una copia JSON."))return;await transaction("readwrite",store=>store.clear());month=(nowBogota().slice(0,7) < FIRST_MONTH ? FIRST_MONTH : nowBogota().slice(0,7));await seedVariableCategories();await refresh();showToast("Movimientos eliminados y categorías iniciales disponibles.")}

/* FUNCIONES AVANZADAS · edición local independiente */
let categoryKind="income",conceptSelection=null,fixedEditing=null,quickPayPlanId=null,quickPaySaving=false;
const categoryNames={income:"Ingresos",variable:"Gastos variables",fixed:"Gastos fijos",receivable:"Deudas a favor",payable:"Deudas en contra"};
const categoryColors=["#65bda0","#eead80","#8b9dcc","#b9a0d8","#d77d75","#a3bb6f","#5f97ae"];
const fixedNameKey=label=>label.toLocaleLowerCase("es-CO");
const isFixedExpense=x=>x.kind==="expense"&&x.expenseClass==="fixed";
function fixedPlans(period){
 const byName=new Map();
 for(const x of entries.filter(x=>x.kind==="fixed_plan"&&x.date.slice(0,7)<=period).sort((a,b)=>a.date.localeCompare(b.date)||a.created.localeCompare(b.created))){
   byName.set(fixedNameKey(x.category),x);
 }
 return [...byName.values()].sort((a,b)=>a.dueDay-b.dueDay||a.category.localeCompare(b.category));
}
function paidFixed(period,cat){
 return entries.filter(x=>isFixedExpense(x)&&x.date.slice(0,7)===period&&fixedNameKey(x.category)===fixedNameKey(cat)).reduce((s,x)=>s+x.amount,0);
}
function dueData(plan,period){
 const [year,mon]=period.split("-").map(Number),maxDay=new Date(Date.UTC(year,mon,0)).getUTCDate();
 const due=period+"-"+String(Math.min(maxDay,plan.dueDay)).padStart(2,"0"),paid=paidFixed(period,plan.category);
 const today=nowBogota(),days=Math.round((Date.parse(due+"T12:00:00Z")-Date.parse(today+"T12:00:00Z"))/86400000);
 const future=period>today.slice(0,7),past=period<today.slice(0,7);
 const status=paid>0?"paid":future?"upcoming":past?"overdue":days<0?"overdue":days<=2?"urgent":"upcoming";
 return {...plan,due,paid,days,status};
}
function eligiblePlans(){return fixedPlans(month).map(p=>dueData(p,month))}
function fixedCategoryRows(plans,movements){
 const plannedNames=new Set(plans.map(plan=>fixedNameKey(plan.category)));
 const rows=plans.map(plan=>({
  id:plan.id,label:plan.category||"Sin concepto",amount:plan.amount,date:plan.due,
  status:plan.status==="urgent"&&plan.days===0?"today":plan.status,scheduled:true
 }));
 for(const movement of movements){
  if(!plannedNames.has(fixedNameKey(movement.category))){
   rows.push({id:movement.id,label:movement.category||"Sin concepto",amount:movement.amount,date:movement.date,status:"paid",scheduled:false});
  }
 }
 return rows.sort((a,b)=>Number(a.status==="paid")-Number(b.status==="paid")||a.date.localeCompare(b.date)||a.label.localeCompare(b.label,"es-CO"));
}
function fixedCategoryRowHtml(row){
 const label=safe(row.label),id=safe(row.id),initial=safe(Array.from(row.label)[0].toLocaleUpperCase("es-CO"));
 const status={paid:"Pagado",overdue:"Vencido",today:"Hoy",urgent:"Próximo",upcoming:"Pendiente"}[row.status];
 const edit=row.scheduled?"data-plan":"data-edit",remove=row.scheduled?"data-remove-plan":"data-delete";
 return `<article class="fixed-category-row" data-row-id="${id}">
  <span class="fixed-category-avatar" aria-hidden="true">${initial}</span>
  <button type="button" class="fixed-category-detail" data-concept="${label}" aria-label="Ver detalle de ${label}">
   <strong>${label}</strong>
   <small><time datetime="${safe(row.date)}" aria-label="${niceDate(row.date)}">${niceDate(row.date,true)}</time> · ${status}</small>
  </button>
  <strong class="fixed-category-amount">${money(row.amount)}</strong>
  <div class="fixed-category-actions">
   <button type="button" ${edit}="${id}" aria-label="Editar ${label}" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/></svg></button>
   <button type="button" ${remove}="${id}" aria-label="Eliminar ${label}" title="Eliminar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7"/></svg></button>
  </div>
 </article>`;
}
function line(label,value,sub=""){return '<div class="balance-line"><div><strong>'+safe(label)+'</strong>'+(sub?'<small>'+safe(sub)+'</small>':"")+'</div><b>'+money(value)+'</b></div>'}
function categoryItems(kind){
 const result=new Map(),periodEntries=entries.filter(x=>x.date.slice(0,7)===month);
 function add(label,amount=0){const key=label||"Sin concepto";result.set(key,(result.get(key)||0)+amount)}
 if(kind==="income"){
  for(const x of entries.filter(x=>x.kind==="income"))add(x.category,0);
  for(const x of periodEntries.filter(x=>x.kind==="income"))add(x.category,x.amount);
  for(const x of periodEntries.filter(x=>x.kind==="payment"&&entries.find(d=>d.id===x.debtId)?.direction==="receivable"))add(entries.find(d=>d.id===x.debtId)?.category,x.amount);
 }else if(kind==="fixed"){
  for(const p of fixedPlans(month))add(p.category,0);
  for(const x of periodEntries.filter(x=>x.kind==="expense"&&x.expenseClass==="fixed"))add(x.category,x.amount);
 }else if(kind==="variable"){
  for(const x of entries.filter(x=>x.kind==="expense"&&x.expenseClass!=="fixed"||x.kind==="category_variable"))add(x.category,0);
  for(const x of periodEntries.filter(x=>x.kind==="expense"&&x.expenseClass!=="fixed"))add(x.category,x.amount);
 }else{
  for(const d of entries.filter(x=>x.kind==="debt"&&x.direction===kind&&x.date<=month+"-31")){const remaining=debtBalance(d,month+"-31");if(remaining>0)add(d.category,remaining);}
 }
 return [...result].map(([label,amount])=>({label,amount})).sort((a,b)=>b.amount-a.amount||a.label.localeCompare(b.label));
}
function enhancedRender(s){
 const plans=eligiblePlans(),fixedMovements=s.monthly.filter(isFixedExpense);
 const fixedPaid=fixedMovements.reduce((sum,x)=>sum+x.amount,0);
 const planned=plans.reduce((a,p)=>a+p.amount,0);
 const upcoming=plans.filter(p=>p.status!=="paid"&&p.amount>0).sort((a,b)=>a.due.localeCompare(b.due)||a.category.localeCompare(b.category)).slice(0,3);
 $("fixedPaid").textContent=money(fixedPaid);
 $("fixedAlerts").classList.toggle("hidden",!upcoming.length);
 $("alertItems").innerHTML=upcoming.map(p=>{
  return '<button type="button" class="priority-row" data-due="'+safe(p.id)+'" aria-label="Pagar '+safe(p.category)+', día '+p.due.slice(-2)+', '+money(p.amount)+'"><span class="priority-day">'+Number(p.due.slice(-2))+'</span><span class="priority-name">'+safe(p.category)+'</span><strong class="priority-amount">'+money(p.amount)+'</strong></button>';
 }).join("");

 const allOutflows=s.monthly.reduce((sum,x)=>sum+(x.kind==="expense"?x.amount:x.kind==="payment"&&amountClass(x)==="negative"?x.amount:0),0);
 const inflows=s.income,flowTotal=inflows+allOutflows;
 const percent=flowTotal?Math.round(inflows/flowTotal*10000)/100:0;
 $("cashflowDonut").style.background=flowTotal?"conic-gradient(#31b887 0% "+percent+"%,#ed9c80 "+percent+"% 100%)":"conic-gradient(#e8edf1 0% 100%)";
 $("cashflowTotal").textContent=money(flowTotal);$("chartIncome").textContent=money(inflows);$("chartExpense").textContent=money(allOutflows);
 $("cashflowDonut").setAttribute("aria-label","Ingresos "+money(inflows)+", egresos "+money(allOutflows));
 const variableGroups=Object.entries(s.groups).filter(([cat])=>s.monthly.some(x=>x.kind==="expense"&&x.expenseClass!=="fixed"&&x.category===cat)).map(([cat])=>[cat,s.monthly.filter(x=>x.kind==="expense"&&x.expenseClass!=="fixed"&&x.category===cat).reduce((sum,x)=>sum+x.amount,0)]).sort((a,b)=>b[1]-a[1]);
 const variableMax=Math.max(1,...variableGroups.map(x=>x[1]));
 $("variableCategoryBars").innerHTML=variableGroups.length?variableGroups.map(([name,value],i)=>'<button type="button" class="variable-bar-row" data-variable-category="'+safe(name)+'" aria-label="Abrir '+safe(name)+', '+money(value)+'"><span class="variable-bar-label"><span>'+safe(name)+'</span><strong>'+money(value)+'</strong></span><span class="variable-bar-track"><span class="variable-bar-fill" style="width:'+Math.round(value/variableMax*100)+'%;background:'+categoryColors[i%categoryColors.length]+'"></span></span></button>').join(""):empty("Todavía no hay gastos variables. Las categorías aparecerán aquí al registrar importes.");
 const openDebts=entries.filter(x=>x.kind==="debt"&&x.direction==="payable"&&x.date<=s.until).map(d=>({id:d.id,label:d.category,balance:debtBalance(d,s.until)})).filter(x=>x.balance>0).sort((a,b)=>b.balance-a.balance);
 $("reminderDebtTotal").textContent=money(openDebts.reduce((sum,x)=>sum+x.balance,0));
 $("reminderDebtRows").innerHTML=openDebts.length?openDebts.slice(0,3).map(d=>'<button type="button" class="home-debt-row" data-reminder-debt="'+safe(d.id)+'"><span><strong>'+safe(d.label)+'</strong><small>Pendiente por pagar</small></span><b>'+money(d.balance)+'</b></button>').join(""):empty("No tienes deudas en contra pendientes.");
 const items=categoryItems(categoryKind),total=items.reduce((a,x)=>a+x.amount,0),max=Math.max(1,...items.map(x=>x.amount));
 $("categoryMetricLabel").textContent=categoryKind==="fixed"?"Total pagado":categoryKind==="payable"||categoryKind==="receivable"?"Saldo pendiente":"Total del mes";
 $("categoryMetricTotal").textContent=money(total);$("categoryMetricCount").textContent=String(items.length);
 $("categoriesView").dataset.category=categoryKind;
 $("categoryTabs").querySelectorAll("button").forEach(b=>{const selected=b.dataset.category===categoryKind;b.classList.toggle("active",selected);b.setAttribute("aria-pressed",String(selected))});
 const isDebtCategory=categoryKind==="payable"||categoryKind==="receivable";
 $("categoryMetrics").classList.toggle("hidden",isDebtCategory);
 $("categoryListCaption").classList.toggle("is-debt-caption",isDebtCategory);
 $("categoryListTitle").textContent=isDebtCategory?"Saldo pendiente":categoryKind==="fixed"?"Vencimientos":"Valores por concepto";
 $("debtCategoryTotal").classList.toggle("hidden",!isDebtCategory);$("debtCategoryTotal").textContent=money(total);
 $("newVariableCategory").classList.toggle("hidden",categoryKind!=="variable");
 $("categoryAddBtn").classList.toggle("hidden",isDebtCategory);
 $("categoryAddBtn").textContent=categoryKind==="fixed"?"+ Gasto fijo":"+ Movimiento";
 $("categoryRows").className="panel "+(isDebtCategory?"debt-receivables":categoryKind==="fixed"?"fixed-category-list":"concept-list");
 if(isDebtCategory){
  const debtItems=debtRows(categoryKind,s.until);
  $("categoryRows").innerHTML=debtItems.length?debtItems.map(debtRowHtml).join(""):empty(categoryKind==="receivable"?"No tienes deudas por cobrar.":"No tienes deudas por pagar.");
 }else if(categoryKind==="fixed"){
  const rows=fixedCategoryRows(plans,fixedMovements);
  $("categoryMetricCount").textContent=String(new Set(rows.map(row=>fixedNameKey(row.label))).size);
  $("categoryRows").innerHTML=rows.length?rows.map(fixedCategoryRowHtml).join(""):empty("Agrega tu primer gasto desde + Gasto fijo.");
 }else{
  $("categoryRows").innerHTML=items.length?items.map(x=>'<div class="concept-card"><button type="button" class="concept-open" data-concept="'+safe(x.label)+'" aria-label="Ver detalle de '+safe(x.label)+', '+money(x.amount)+'"><span class="concept-card-heading"><strong>'+safe(x.label)+'</strong><b>'+money(x.amount)+'</b><span class="concept-chevron" aria-hidden="true">›</span></span><span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:'+Math.round(100*x.amount/max)+'%"></span></span></button></div>').join(""):empty("Agrega tu primer concepto desde el botón +.");
 }
 const endBal=s.balances.digital+s.balances.cash,starting=accountBalance(month+"-00");
 const startBalance=starting.digital+starting.cash,expFixed=fixedPaid,expVariable=s.monthly.filter(x=>x.kind==="expense"&&x.expenseClass!=="fixed").reduce((a,x)=>a+x.amount,0);
 const debtPayable=entries.filter(x=>x.kind==="debt"&&x.direction==="payable"&&x.date<=s.until).reduce((a,x)=>a+debtBalance(x,s.until),0);
 const debtReceivable=entries.filter(x=>x.kind==="debt"&&x.direction==="receivable"&&x.date<=s.until).reduce((a,x)=>a+debtBalance(x,s.until),0);
 $("balanceHeading").textContent="Balance · "+monthText(month);$("balancePeriodChip").textContent=monthText(month);
 $("balanceClosing").textContent=money(endBal);$("balanceDigital").textContent=money(s.balances.digital);$("balanceCash").textContent=money(s.balances.cash);
 $("balanceLines").innerHTML=line("Disponible trasladado",startBalance,"Cierre del mes anterior")+line("Ingresos y cobros",s.income)+line("Gastos variables",expVariable)+line("Gastos fijos pagados",expFixed)+line("Abonos de deudas por pagar",s.expenses-expFixed-expVariable)+line("Deudas a favor pendientes",debtReceivable)+line("Deudas en contra pendientes",debtPayable)+line("Patrimonio neto estimado",endBal+debtReceivable-debtPayable);
 const flows=[["Saldo inicial",startBalance],["Ingresos",s.income],["Salidas",s.expenses],["Saldo final",endBal]],base=Math.max(1,...flows.map(x=>Math.abs(x[1])));
 $("balanceFlow").innerHTML=flows.map(([name,v],i)=>'<div class="category-line"><div class="category-row"><span>'+safe(name)+'</span><strong>'+money(v)+'</strong></div><div class="bar-track"><div class="bar-fill" style="width:'+Math.round(100*Math.abs(v)/base)+'%;background:'+categoryColors[i]+'"></div></div></div>').join("");
 $("balanceFixed").innerHTML=line("Total previsto",planned)+line("Total pagado",fixedPaid)+line("Por pagar",Math.max(0,planned-fixedPaid))+ (plans.length?plans.map(p=>'<div class="balance-line"><div><strong>'+safe(p.category)+'</strong><small>Vence el día '+p.dueDay+' · '+(p.status==="paid"?"Pagado":p.status==="overdue"?"Vencido":p.status==="urgent"?"Próximo":"Pendiente")+'</small></div><b>'+money(p.paid)+' / '+money(p.amount)+'</b></div>').join(""):"");
}
function openFixed(plan=null){
 fixedEditing=plan;$("fixedForm").reset();$("fixedDialogTitle").textContent=plan?"Editar gasto fijo":"Nuevo gasto fijo";
 $("fixedName").value=plan?.category||"";$("fixedAmount").value=plan?.amount??"";$("fixedDay").value=plan?.dueDay||"";$("fixedFrom").value=plan?.date.slice(0,7)||month;$("fixedFormError").textContent="";$("fixedDialog").showModal();
}
async function saveFixed(e){
 e.preventDefault();
 const submit=$("saveFixedBtn");
 if(submit.disabled)return;
 const category=$("fixedName").value.trim(),rawAmount=$("fixedAmount").value,amount=Number(rawAmount),day=Number($("fixedDay").value),from=$("fixedFrom").value;
 if(!category||!rawAmount||!Number.isSafeInteger(amount)||amount<0||!Number.isInteger(day)||day<1||day>31||!/^20\d\d-(0[1-9]|1[0-2])$/.test(from)||from<FIRST_MONTH){$("fixedFormError").textContent="Revisa el concepto, el importe, el día (1-31) y el mes inicial.";return}
 const newName=fixedNameKey(category),oldName=fixedEditing?fixedNameKey(fixedEditing.category):newName;
 const existing=entries.find(x=>x.kind==="fixed_plan"&&x.id!==fixedEditing?.id&&[oldName,newName].includes(fixedNameKey(x.category))&&x.date.slice(0,7)===from);
 if(existing){$("fixedFormError").textContent="Ya existe un plan con este concepto y mes. Edítalo en lugar de duplicarlo.";return}
 if(oldName!==newName&&entries.some(x=>(x.kind==="fixed_plan"||isFixedExpense(x))&&fixedNameKey(x.category)===newName)){
  $("fixedFormError").textContent="Ya existe otro gasto fijo con ese concepto.";return;
 }
 const related=fixedEditing&&fixedEditing.category!==category?entries.filter(x=>x.id!==fixedEditing.id&&(x.kind==="fixed_plan"||isFixedExpense(x))&&fixedNameKey(x.category)===oldName):[];
 const item={id:fixedEditing?.id||uid(),kind:"fixed_plan",created:fixedEditing?.created||new Date().toISOString(),date:from+"-01",account:"digital",category,description:"",amount,dueDay:day};
 submit.disabled=true;UI?.saving("fixedForm",true);
 try{
  await transaction("readwrite",store=>{
   store.put(item);
   for(const record of related)store.put({...record,category});
  });
  $("fixedDialog").close();await refresh();showToast("Gasto fijo guardado.");
 }catch(err){$("fixedFormError").textContent="No se pudo guardar el gasto fijo."}
 finally{UI?.saving("fixedForm",false);submit.disabled=false}
}
async function removeFixedPlan(id){
 const plan=entries.find(x=>x.id===id&&x.kind==="fixed_plan");
 if(!plan||!confirm("¿Eliminar la programación recurrente de "+plan.category+"? Los pagos ya registrados se conservarán."))return;
 const plans=entries.filter(x=>x.kind==="fixed_plan"&&fixedNameKey(x.category)===fixedNameKey(plan.category));
 try{
  await transaction("readwrite",store=>{for(const record of plans)store.delete(record.id)});
  if($("conceptDialog").open)$("conceptDialog").close();
  await refresh();showToast("Plan recurrente eliminado.");
 }catch(err){showToast("No fue posible eliminar el plan.")}
}
function payDue(id){
 const plan=eligiblePlans().find(p=>p.id===id);
 if(!plan||plan.status==="paid"){showToast("Este pago ya está registrado.");return}
 if(plan.amount<=0){showToast("Configura un importe previsto mayor que cero.");return}
 quickPayPlanId=plan.id;
 $("quickPayForm").reset();
 $("quickPayDescription").textContent=plan.category+" · Vence el "+niceDate(plan.due);
 $("quickPayAmount").value=String(plan.amount);
 const today=nowBogota();
 $("quickPayDate").value=today.slice(0,7)===month?today:month+"-01";
 $("quickPayAccount").value="digital";
 $("quickPayError").textContent="";
 $("confirmQuickPay").disabled=false;
 $("quickPayDialog").showModal();
}
async function confirmQuickPay(event){
 event.preventDefault();
 if(quickPaySaving)return;
 const plan=eligiblePlans().find(p=>p.id===quickPayPlanId);
 if(!plan||plan.status==="paid"){$("quickPayError").textContent="El pago ya fue registrado o el gasto fijo cambió.";return}
 const amount=Number($("quickPayAmount").value),date=$("quickPayDate").value,account=$("quickPayAccount").value;
 if(!Number.isSafeInteger(amount)||amount<=0){$("quickPayError").textContent="Introduce un importe válido mayor a cero.";return}
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date.slice(0,7)!==month||date<START||!Number.isFinite(Date.parse(date+"T12:00:00Z"))){$("quickPayError").textContent="Selecciona una fecha válida dentro de "+monthText(month)+".";return}
 if(account!=="digital"&&account!=="cash"){$("quickPayError").textContent="Selecciona una cuenta válida.";return}
 const item={id:uid(),kind:"expense",expenseClass:"fixed",category:plan.category,description:"Pago fijo",amount,date,account,created:new Date().toISOString(),target:null,direction:null,debtId:null};
 quickPaySaving=true;$("confirmQuickPay").disabled=true;UI?.saving("quickPayForm",true);
 try{
  await transaction("readwrite",store=>store.put(item));
  $("quickPayDialog").close();quickPayPlanId=null;
  await refresh();showToast("Pago registrado. Disponible actualizado.");
 }catch(err){$("quickPayError").textContent="No se pudo guardar: "+err.message}
 finally{UI?.saving("quickPayForm",false);quickPaySaving=false;$("confirmQuickPay").disabled=false}
}
function relatedTo(kind,label){
 return entries.filter(x=>{if(kind==="income")return x.date.slice(0,7)===month&&(x.kind==="income"&&x.category===label||x.kind==="payment"&&entries.some(d=>d.id===x.debtId&&d.direction==="receivable"&&d.category===label));
 if(kind==="fixed")return isFixedExpense(x)&&fixedNameKey(x.category||"Sin concepto")===fixedNameKey(label)&&x.date.slice(0,7)===month;
 if(kind==="variable")return x.kind==="expense"&&x.expenseClass!=="fixed"&&x.category===label&&x.date.slice(0,7)===month;
 return x.kind==="debt"&&x.direction===kind&&x.category===label&&x.date.slice(0,7)<=month});
}
function openConcept(label){
 conceptSelection={kind:categoryKind,label};$("conceptDialogTitle").textContent=label;$("deleteVariableCategory").classList.toggle("hidden",categoryKind!=="variable");
 const rows=relatedTo(categoryKind,label),plan=categoryKind==="fixed"?eligiblePlans().find(p=>fixedNameKey(p.category||"Sin concepto")===fixedNameKey(label)):null;
 $("conceptDetails").innerHTML=(plan?line("Previsto",plan.amount,"Día de pago "+plan.dueDay)+'<button class="small-action danger" data-remove-plan="'+safe(plan.id)+'">Eliminar plan recurrente</button>':"")+(rows.length?rows.map(x=>{
  const isDebt=x.kind==="debt",remaining=isDebt?debtBalance(x,month+"-31"):x.amount;
  return '<div class="concept-detail-record"><div class="concept-item"><div class="concept-name"><strong>'+niceDate(x.date)+'</strong><small>'+safe(x.description||kinds[x.kind])+(isDebt?' · Inicial '+money(x.amount):'')+'</small></div><div class="concept-right"><strong>'+money(remaining)+'</strong><button class="mini-btn" data-concept-edit="'+safe(x.id)+'">Editar</button></div></div>'+(isDebt&&remaining>0?'<div class="debt-detail-actions"><button type="button" class="small-action" data-pay="'+safe(x.id)+'">Abonar</button><button type="button" class="small-action" data-settle="'+safe(x.id)+'">Pagado total</button></div>':"")+'</div>';
 }).join(""):empty("Aún no hay movimientos de este concepto en el mes seleccionado."));
 $("conceptDialog").showModal();
}
async function renameSelected(){
 if(!conceptSelection)return;const {kind,label}=conceptSelection;
 const next=prompt("Nuevo nombre para "+label,label)?.trim();if(!next||next===label)return;
 const changing=entries.filter(x=>kind==="income"?x.kind==="income"&&x.category===label:kind==="variable"?(x.kind==="category_variable"||x.kind==="expense"&&x.expenseClass!=="fixed")&&x.category===label:kind==="fixed"?(x.kind==="fixed_plan"||x.kind==="expense"&&x.expenseClass==="fixed")&&x.category===label:x.kind==="debt"&&x.direction===kind&&x.category===label);
 const elsewhere=entries.some(x=>x.category?.toLocaleLowerCase("es-CO")===next.toLocaleLowerCase("es-CO")&&x.category!==label&&changing.some(y=>y.kind===x.kind));
 if(elsewhere){showToast("Ya existe otro concepto con ese nombre.");return}
 await transaction("readwrite",store=>{for(const x of changing)store.put({...x,category:next})});
 $("conceptDialog").close();await refresh();showToast("Concepto renombrado.");
}

function openVariableCategory(){
 $("variableCategoryForm").reset();$("variableCategoryError").textContent="";$("variableCategoryDialog").showModal();
}
async function saveVariableCategory(e){
 e.preventDefault();if(UI&&$("variableCategoryForm").getAttribute("aria-busy")==="true")return;
 const name=$("variableCategoryName").value.trim().replace(/\s+/g," ");
 if(!name||name.length>60){$("variableCategoryError").textContent="Introduce un nombre válido de hasta 60 caracteres.";return}
 if(variableCategoryNames().some(x=>categoryKey(x)===categoryKey(name))){$("variableCategoryError").textContent="Este concepto ya existe.";return}
 const record={id:uid(),kind:"category_variable",date:START,created:new Date().toISOString(),account:"digital",category:name,description:"",amount:0};
 UI?.saving("variableCategoryForm",true);
 try{await transaction("readwrite",store=>store.put(record));$("variableCategoryDialog").close();await refresh();if($("entryDialog").open){$("entryCategory").value=name;addOptions()}showToast("Categoría creada.")}catch(err){$("variableCategoryError").textContent=err.message}finally{UI?.saving("variableCategoryForm",false)}
}
async function removeVariableCategory(){
 if(!conceptSelection||conceptSelection.kind!=="variable")return;
 const label=conceptSelection.label;
 const used=entries.some(x=>x.kind==="expense"&&x.expenseClass!=="fixed"&&categoryKey(x.category)===categoryKey(label));
 if(used){showToast("Hay gastos registrados. Renombra el concepto o edita los gastos antes de quitarlo.");return}
 if(!confirm("¿Quitar la categoría "+label+" de tus opciones?"))return;
 const targets=entries.filter(x=>x.kind==="category_variable"&&categoryKey(x.category)===categoryKey(label));
 await transaction("readwrite",store=>{for(const x of targets)store.delete(x.id)});
 $("conceptDialog").close();await refresh();showToast("Categoría retirada.");
}

async function deleteSelected(){
 if(!conceptSelection)return;const {kind,label}=conceptSelection;const rows=relatedTo(kind,label);
 const dependencies=rows.filter(x=>x.kind==="debt"&&entries.some(p=>p.kind==="payment"&&p.debtId===x.id));
 if(dependencies.length){showToast("Elimina primero los abonos de estas deudas.");return}
 if(!rows.length){showToast("No hay movimientos en este período para eliminar.");return}
 if(!confirm("¿Eliminar "+rows.length+" registro(s) de "+label+" en el período "+monthText(month)+"?"))return;
 await transaction("readwrite",store=>{rows.forEach(x=>store.delete(x.id))});$("conceptDialog").close();await refresh();showToast("Registros del concepto eliminados.");
}
async function undoLatest(){
 const latest=entries.filter(x=>!["fixed_plan","category_variable","category_seed"].includes(x.kind)).slice().sort((a,b)=>b.created.localeCompare(a.created))[0];
 if(!latest){showToast("No hay registros para deshacer.");return}
 if(latest.kind==="debt"&&entries.some(p=>p.kind==="payment"&&p.debtId===latest.id)){showToast("Elimina primero los abonos de esta deuda.");return}
 if(!confirm("¿Deshacer el último registro: "+recordTitle(latest)+" · "+money(latest.amount)+"?"))return;
 await transaction("readwrite",store=>store.delete(latest.id));await refresh();showToast("Último registro deshecho.");
}
function enhancedBind(){
 $("debtPaymentForm").addEventListener("submit",saveDebtPayment);
 $("closeDebtPayment").addEventListener("click",()=>closeDebtPayment());
 $("debtPaymentDialog").addEventListener("cancel",event=>{event.preventDefault();closeDebtPayment()});
 $("debtPaymentAmount").addEventListener("input",()=>{$("debtPaymentError").textContent="";syncDirectPayment()});
 $("debtPaymentAccount").addEventListener("change",syncDirectPayment);
 $("fillDebtPayment").addEventListener("click",()=>{$("debtPaymentAmount").value=String(debtPaymentRemaining());$("debtPaymentError").textContent="";syncDirectPayment()});
 $("deleteEditingDebt").addEventListener("click",async()=>{if(!editing||editing.kind!=="debt")return;const id=editing.id;await removeEntry(id);if(!entries.some(x=>x.id===id))closeEntry()});
 document.querySelectorAll("[data-entry-kind]").forEach(button=>button.addEventListener("click",()=>{
  $("entryKind").value=button.dataset.entryKind==="debt"?(editing?.kind==="debt"?"debt":"payment"):button.dataset.entryKind;
  $("debtAction").value=$("entryKind").value==="debt"?"new":"payment";selectedDebt=null;$("entryDebt").value="";
  $("entryCategory").value="";
  adjustForm();
 }));
 $("debtAction").addEventListener("change",()=>{
  $("entryKind").value=$("debtAction").value==="new"?"debt":"payment";adjustForm();
 });
 $("entryDirection").addEventListener("change",()=>{selectedDebt=null;$("entryDebt").value="";if($("entryKind").value==="payment")populateDebtOptions(editing?.id);else syncDebtPayment()});
 $("entryDebt").addEventListener("change",()=>{selectedDebt=$("entryDebt").value||null;syncDebtPayment()});
 $("entryAccount").addEventListener("change",syncDebtPayment);
 $("entryDialog").addEventListener("cancel",()=>{if($("entryDialog").contains(document.activeElement))document.activeElement.blur()});
 $("undoLatest").addEventListener("click",undoLatest);
 $("variableCategoryBars").addEventListener("click",e=>{const b=e.target.closest("[data-variable-category]");if(!b)return;categoryKind="variable";navigate("categories");render();openConcept(b.dataset.variableCategory)});
 $("reminderDebtRows").addEventListener("click",e=>{const b=e.target.closest("[data-reminder-debt]");if(!b)return;categoryKind="payable";navigate("categories");render();const d=entries.find(x=>x.id===b.dataset.reminderDebt);if(d)openConcept(d.category)});
 $("newVariableCategory").addEventListener("click",openVariableCategory);
 $("variableCategoryForm").addEventListener("submit",saveVariableCategory);
 $("closeVariableCategory").addEventListener("click",()=>$("variableCategoryDialog").close());
 $("cancelVariableCategory").addEventListener("click",()=>$("variableCategoryDialog").close());
 $("deleteVariableCategory").addEventListener("click",removeVariableCategory);
 $("variableCategoryPicker").addEventListener("change",()=>{
  const selected=$("variableCategoryPicker").value;
  if(selected==="__new__"){openVariableCategory();return}
  $("entryCategory").value=selected==="__choose__"?"":selected;
  syncVariableCategoryPicker();
 });
 $("expenseClass").addEventListener("change",addOptions);

 $("openAllFixed").addEventListener("click",()=>{categoryKind="fixed";navigate("categories");render()});
 $("quickPayForm").addEventListener("submit",confirmQuickPay);
 $("closeQuickPay").addEventListener("click",()=>$("quickPayDialog").close());
 $("cancelQuickPay").addEventListener("click",()=>$("quickPayDialog").close());
 document.querySelectorAll("[data-home-category]").forEach(button=>button.addEventListener("click",()=>{categoryKind=button.dataset.homeCategory;navigate("categories");render()}));
 document.querySelectorAll("[data-home-target]").forEach(button=>{
  const go=()=>{if(button.dataset.homeFilter)$("filterKind").value=button.dataset.homeFilter;navigate(button.dataset.homeTarget);render()};
  button.addEventListener("click",go);
  if(button.getAttribute("role")==="button")button.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();go()}});
 });
 $("categoryTabs").addEventListener("click",e=>{const b=e.target.closest("[data-category]");if(b){categoryKind=b.dataset.category;render()}});
 $("categoryAddBtn").addEventListener("click",()=>{if(categoryKind==="fixed")openFixed();else if(categoryKind==="receivable"||categoryKind==="payable"){openForm("debt");$("entryDirection").value=categoryKind;adjustForm();}else openForm(categoryKind==="income"?"income":"expense");if(categoryKind==="variable"){$("expenseClass").value="variable";addOptions()}});
 $("fixedForm").addEventListener("submit",saveFixed);
 $("closeFixedDialog").addEventListener("click",()=>$("fixedDialog").close());
 $("cancelFixed").addEventListener("click",()=>$("fixedDialog").close());
 $("closeConceptDialog").addEventListener("click",()=>$("conceptDialog").close());
 $("renameConcept").addEventListener("click",renameSelected);
 $("deleteConcept").addEventListener("click",deleteSelected);
 document.addEventListener("click",async e=>{
  const b=e.target.closest("[data-plan],[data-due],[data-concept],[data-concept-edit],[data-remove-plan]");if(!b)return;
  if(b.dataset.removePlan){await removeFixedPlan(b.dataset.removePlan)}
  else if(b.dataset.plan){const plan=entries.find(x=>x.id===b.dataset.plan&&x.kind==="fixed_plan");if(plan)openFixed(plan)}
  else if(b.dataset.due){payDue(b.dataset.due)}
  else if(b.dataset.concept){openConcept(b.dataset.concept)}
  else if(b.dataset.conceptEdit){$("conceptDialog").close();const x=entries.find(x=>x.id===b.dataset.conceptEdit);if(x){if(x.kind==="payment")openDebtPayment(x.debtId,x);else openForm(x.kind,x)}}
 });
}

function bind(){
 document.querySelectorAll("[data-nav]").forEach(x=>x.addEventListener("click",()=>navigate(x.dataset.nav)));
 $("openMoreMenu").addEventListener("click",openMoreSheet);
 $("closeMoreMenu").addEventListener("click",closeMoreSheet);
 $("sheetBackdrop").addEventListener("click",closeMoreSheet);
 document.querySelectorAll("[data-sheet-nav]").forEach(x=>x.addEventListener("click",()=>navigate(x.dataset.sheetNav)));
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("moreSheet").classList.contains("hidden"))closeMoreSheet()});
$("settingsButton").addEventListener("click",()=>navigate("preferences"));$("movementSearch").addEventListener("input",render);$("prevMonth").addEventListener("click",()=>moveMonth(-1));$("nextMonth").addEventListener("click",()=>moveMonth(1));$("filterKind").addEventListener("change",render);$("fab").addEventListener("click",()=>openForm());$("newDebtBtn").addEventListener("click",()=>openForm("debt"));$("entryKind").addEventListener("change",adjustForm);$("entryDate").addEventListener("change",()=>{if($("entryKind").value==="payment")populateDebtOptions(editing?.kind==="payment"?editing.id:null)});$("entryAccount").addEventListener("change",()=>{if($("entryKind").value==="transfer")$("entryTarget").value=$("entryAccount").value==="digital"?"cash":"digital"});$("entryForm").addEventListener("submit",saveForm);$("closeDialog").addEventListener("click",closeEntry);$("cancelEntry").addEventListener("click",closeEntry);document.addEventListener("click",e=>{const b=e.target.closest("[data-edit],[data-delete],[data-pay],[data-settle]");if(!b)return;if(b.dataset.edit){const x=entries.find(z=>z.id===b.dataset.edit);if(x){if(x.kind==="payment")openDebtPayment(x.debtId,x);else openForm(x.kind,x)}}else if(b.dataset.delete)removeEntry(b.dataset.delete);else if(b.dataset.pay||b.dataset.settle){openDebtPayment(b.dataset.pay||b.dataset.settle,null,Boolean(b.dataset.settle))}});$("exportBackup").addEventListener("click",exportBackup);$("exportCsv").addEventListener("click",exportCsv);$("importBackup").addEventListener("click",()=>$("backupFile").click());$("backupFile").addEventListener("change",e=>importBackup(e.target.files?.[0]));$("eraseData").addEventListener("click",eraseAll);enhancedBind();UI?.init({detail:renderMovementDetail,onView:name=>{view=name},transfer:()=>openForm("transfer")})}
async function init(){try{db=await openDB();await seedVariableCategories();month=(nowBogota().slice(0,7) < FIRST_MONTH ? FIRST_MONTH : nowBogota().slice(0,7));bind();navigate("dashboard");await refresh();if("serviceWorker"in navigator&&location.protocol==="https:")navigator.serviceWorker.register("./sw.js").catch(()=>{});if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{})}catch(err){document.querySelector("main").innerHTML='<div class="panel empty-small">No se pudo iniciar Cash Control. Revisa la fecha del dispositivo y vuelve a cargar la aplicación.<br>'+safe(err.message)+'</div>';$("fab").hidden=true;$("appMain").setAttribute("aria-busy","false");console.error(err)}}
init();
})();
