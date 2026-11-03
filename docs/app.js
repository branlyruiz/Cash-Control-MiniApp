"use strict";
(function(){
const START="2026-11-01", FIRST_MONTH="2026-11", DB_NAME="BR_CASH_CONTROL_LOCAL_V1";
const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(Number(n)||0);
const niceDate=s=>new Intl.DateTimeFormat("es-CO",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(s+"T12:00:00Z"));
const monthText=s=>new Intl.DateTimeFormat("es-CO",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(s+"-01T12:00:00Z"));
const nowBogota=()=>{const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Bogota",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const part=type=>parts.find(x=>x.type===type)?.value||"";return `${part("year")}-${part("month")}-${part("day")}`};
const safe=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid=()=>typeof crypto!=="undefined"&&crypto.randomUUID?crypto.randomUUID():"br-"+Date.now()+"-"+Math.random().toString(36).slice(2);
let db,entries=[],view="dashboard",month=FIRST_MONTH,editing=null,toastTimer=null,selectedDebt=null;
const kinds={income:"Ingreso",expense:"Gasto",transfer:"Transferencia",debt:"Deuda",payment:"Abono"};
const accountNames={digital:"Digital",cash:"Efectivo"};
function showToast(msg){const el=$("toast");el.textContent=msg;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),3000)}
function openDB(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>{const d=request.result;if(!d.objectStoreNames.contains("entries")){const store=d.createObjectStore("entries",{keyPath:"id"});store.createIndex("date","date")}};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
function transaction(mode,fn){return new Promise((resolve,reject)=>{const tx=db.transaction("entries",mode),store=tx.objectStore("entries");let result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("Transacción cancelada"));try{result=fn(store,tx)}catch(e){tx.abort();reject(e)}})}
function allEntries(){return new Promise((resolve,reject)=>{const req=db.transaction("entries").objectStore("entries").getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function refresh(){entries=(await allEntries()).sort((a,b)=>b.date.localeCompare(a.date)||b.created.localeCompare(a.created));render()}
const isMoney=o=>["income","expense","transfer","payment"].includes(o.kind);
const paidTo=(id,until)=>entries.filter(x=>x.kind==="payment"&&x.debtId===id&&(!until||x.date<=until)).reduce((s,x)=>s+x.amount,0);
function debtBalance(d,until){return Math.max(0,d.amount-paidTo(d.id,until))}
function debtsAvailable(onDate,excludePaymentId=null){return entries.filter(x=>x.kind==="debt"&&x.date<=onDate).map(d=>({entry:d,remaining:d.amount-entries.filter(p=>p.kind==="payment"&&p.debtId===d.id&&p.id!==excludePaymentId&&p.date<=onDate).reduce((s,p)=>s+p.amount,0)})).filter(d=>d.remaining>0)}
function accountBalance(until){const balances={digital:0,cash:0};for(const x of entries){if(x.date>until)continue;if(x.kind==="income")balances[x.account]+=x.amount;else if(x.kind==="expense")balances[x.account]-=x.amount;else if(x.kind==="transfer"){balances[x.account]-=x.amount;balances[x.target]+=x.amount}else if(x.kind==="payment"){const d=entries.find(q=>q.id===x.debtId);if(d&&d.direction==="receivable")balances[x.account]+=x.amount;else balances[x.account]-=x.amount}}return balances}
function recordTitle(x){if(x.kind==="debt")return x.category||"Deuda";if(x.kind==="payment"){const d=entries.find(q=>q.id===x.debtId);return "Abono · "+(d?.category||"Deuda")}if(x.kind==="transfer")return "Digital ↔ Efectivo";return x.category||kinds[x.kind]||"Movimiento"}
function amountClass(x){return x.kind==="income"?"positive":x.kind==="expense"?"negative":x.kind==="payment"?(entries.find(q=>q.id===x.debtId)?.direction==="receivable"?"positive":"negative"):""}
function amountPrefix(x){return x.kind==="income"?"+":x.kind==="expense"?"−":x.kind==="payment"?(amountClass(x)==="positive"?"+":"−"):""}
function summary(){const until=month+"-31",balances=accountBalance(until),monthly=entries.filter(x=>x.date.slice(0,7)===month);
const income=monthly.reduce((s,x)=>s+(x.kind==="income"?x.amount:x.kind==="payment"&&amountClass(x)==="positive"?x.amount:0),0);
const expenses=monthly.reduce((s,x)=>s+(x.kind==="expense"?x.amount:x.kind==="payment"&&amountClass(x)==="negative"?x.amount:0),0);
const groups={};for(const x of monthly){if(x.kind==="expense")groups[x.category||"Sin categoría"]=(groups[x.category||"Sin categoría"]||0)+x.amount}
return {until,balances,income,expenses,monthly,groups}}
function entryHtml(x,buttons=true){const icon={income:"↙",expense:"↗",transfer:"⇄",debt:"▤",payment:"⇩"}[x.kind];const cls=x.kind==="income"||x.kind==="expense"||x.kind==="payment"?x.kind:(x.kind==="debt"?x.direction:"");
return '<div class="transaction"><div class="transaction-icon '+cls+'">'+icon+'</div><div class="transaction-main"><div class="transaction-name">'+safe(recordTitle(x))+'</div><div class="transaction-date">'+niceDate(x.date)+' · '+safe(x.description||kinds[x.kind])+'</div></div><div class="transaction-side"><div class="transaction-amount '+amountClass(x)+'">'+amountPrefix(x)+money(x.amount)+'</div>'+(buttons?'<div class="transaction-actions"><button class="mini-btn" data-edit="'+safe(x.id)+'">Editar</button><button class="mini-btn" data-delete="'+safe(x.id)+'">Eliminar</button></div>':"")+'</div></div>'}
function empty(message){return '<div class="empty-small">'+safe(message)+'</div>'}
function render(){const s=summary();$("periodLabel").textContent=monthText(month);$("balanceMonth").textContent=monthText(month);$("totalBalance").textContent=money(s.balances.digital+s.balances.cash);$("digitalBalance").textContent=money(s.balances.digital);$("cashBalance").textContent=money(s.balances.cash);$("incomeTotal").textContent=money(s.income);$("expenseTotal").textContent=money(s.monthly.filter(x=>x.kind==="expense"&&x.expenseClass!=="fixed").reduce((sum,x)=>sum+x.amount,0));$("prevMonth").disabled=month<=FIRST_MONTH;
const groupEntries=Object.entries(s.groups).sort((a,b)=>b[1]-a[1]);$("expenseCount").textContent=groupEntries.length+" categorías";
$("categorySummary").innerHTML=groupEntries.length?groupEntries.map(([name,value])=>'<div class="category-line"><div class="category-row"><span>'+safe(name)+'</span><strong>'+money(value)+'</strong></div><div class="bar-track"><div class="bar-fill" style="width:'+Math.min(100,100*value/Math.max(1,s.expenses))+'%"></div></div></div>').join(""):empty("Registra tu primer gasto para ver las categorías.");
const activity=s.monthly.filter(isMoney);$("recentTransactions").innerHTML=activity.length?activity.slice(0,5).map(x=>entryHtml(x,false)).join(""):empty("Aún no tienes movimientos en "+monthText(month)+".");
const filter=$("filterKind").value;const selected=activity.filter(x=>filter==="all"||x.kind===filter||(x.kind==="expense"&&x.expenseClass===filter));$("allTransactions").innerHTML=selected.length?selected.map(x=>entryHtml(x)).join(""):empty("No hay movimientos para este filtro en "+monthText(month)+".");
const historicalDebts=entries.filter(x=>x.kind==="debt"&&x.date<=s.until),active=historicalDebts.map(d=>({entry:d,remaining:debtBalance(d,s.until)}));
$("receivableTotal").textContent=money(active.filter(x=>x.entry.direction==="receivable").reduce((sum,x)=>sum+x.remaining,0));
$("payableTotal").textContent=money(active.filter(x=>x.entry.direction==="payable").reduce((sum,x)=>sum+x.remaining,0));
 $("payableHome").textContent=$("payableTotal").textContent;
$("debtList").innerHTML=active.length?active.map(({entry:d,remaining})=>'<div class="debt-row"><div class="debt-head"><strong>'+safe(d.category)+'</strong><strong>'+money(remaining)+'</strong></div><span class="debt-label">'+(d.direction==="receivable"?"Por cobrar":"Por pagar")+' · Inicial '+money(d.amount)+' · '+niceDate(d.date)+'</span><div class="debt-bottom"><span class="pill">'+(remaining?"Pendiente":"Saldada")+'</span><button class="mini-btn" data-edit="'+safe(d.id)+'">Editar</button><button class="mini-btn" data-delete="'+safe(d.id)+'">Eliminar</button><button class="debt-btn" data-pay="'+safe(d.id)+'" '+(remaining<=0?"disabled":"")+'>Registrar abono</button></div></div>').join(""):empty("Sin deudas. Puedes registrar una desde el botón Nueva.");
 enhancedRender(s);
}
function openMoreSheet(){
 $("moreSheet").classList.remove("hidden");
 $("sheetBackdrop").classList.remove("hidden");
 $("openMoreMenu").setAttribute("aria-expanded","true");
 $("moreSheet").focus();
}
function closeMoreSheet(){
 $("moreSheet").classList.add("hidden");
 $("sheetBackdrop").classList.add("hidden");
 $("openMoreMenu").setAttribute("aria-expanded","false");
}
function navigate(name){
 closeMoreSheet();
 view=name;
 document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===name+"View"));
 document.querySelectorAll(".dock-item").forEach(b=>{
  const active=b.dataset.nav?b.dataset.nav===name:["balance","debts","settings"].includes(name);
  b.classList.toggle("active",active);
  if(b.dataset.nav){if(active)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")}
 });
 $("fab").style.display=name==="settings"?"none":"grid";
 window.scrollTo({top:0,behavior:"auto"});
}
function moveMonth(shift){const [y,m]=month.split("-").map(Number);const d=new Date(Date.UTC(y,m-1+shift,1));const target=d.toISOString().slice(0,7);if(target>=FIRST_MONTH){month=target;render()}}
function addOptions(){const categories=[...new Set(entries.filter(x=>["income","expense"].includes(x.kind)).map(x=>x.category).filter(Boolean))].sort();$("categoriesList").innerHTML=categories.map(x=>'<option value="'+safe(x)+'">').join("")}
function populateDebtOptions(exclude){const date=$("entryDate").value||nowBogota(),list=debtsAvailable(date,exclude);$("entryDebt").innerHTML='<option value="">Selecciona una deuda</option>'+list.map(({entry:d,remaining})=>'<option value="'+safe(d.id)+'">'+safe(d.category)+' · '+money(remaining)+'</option>').join("");if(selectedDebt&&list.some(x=>x.entry.id===selectedDebt))$("entryDebt").value=selectedDebt}
function adjustForm(){const kind=$("entryKind").value;$("expenseClassField").classList.toggle("hidden",kind!=="expense");$("targetField").classList.toggle("hidden",kind!=="transfer");$("categoryField").classList.toggle("hidden",!["income","expense","debt"].includes(kind));$("directionField").classList.toggle("hidden",kind!=="debt");$("debtField").classList.toggle("hidden",kind!=="payment");$("accountField").classList.toggle("hidden",kind==="debt");if(kind==="payment")populateDebtOptions(editing?.kind==="payment"?editing.id:null);$("dialogTitle").textContent=editing?"Editar registro":kind==="debt"?"Nueva deuda":kind==="payment"?"Nuevo abono":"Nuevo movimiento";$("formError").textContent=""}
function openForm(kind="income",record=null,debtId=null){editing=record;selectedDebt=debtId||record?.debtId||null;$("entryForm").reset();$("entryKind").value=record?.kind||kind;$("entryAmount").value=record?.amount||"";$("entryDate").value=record?.date||(nowBogota() < START ? START : nowBogota());$("entryAccount").value=record?.account||"digital";$("entryCategory").value=record?.category||"";$("expenseClass").value=record?.expenseClass||"variable";$("entryDirection").value=record?.direction||"receivable";$("entryDescription").value=record?.description||"";if(record?.target)$("entryTarget").value=record.target;addOptions();adjustForm();if(selectedDebt)$("entryDebt").value=selectedDebt;$("entryDialog").showModal()}
function pendingDebtPayments(id,exclude=null){return entries.filter(x=>x.kind==="payment"&&x.debtId===id&&x.id!==exclude).reduce((s,x)=>s+x.amount,0)}
function validEntry(x,original){if(!["income","expense","transfer","debt","payment"].includes(x.kind))return "Tipo de registro no válido.";if(!/^\d{4}-\d{2}-\d{2}$/.test(x.date)||x.date<START||!Number.isFinite(Date.parse(x.date+"T12:00:00Z")))return "La fecha debe ser desde el 1 de noviembre de 2026.";if(!Number.isSafeInteger(x.amount)||x.amount<=0)return "Introduce un importe entero mayor que cero.";if(!["digital","cash"].includes(x.account))return "Selecciona una cuenta válida.";if(["income","expense","debt"].includes(x.kind)&&!x.category)return "Indica la categoría o concepto.";if(x.kind==="expense"&&!["fixed","variable"].includes(x.expenseClass))return "Selecciona gasto fijo o variable.";if(x.kind==="transfer"&&(!["digital","cash"].includes(x.target)||x.account===x.target))return "La cuenta de destino debe ser diferente.";if(original?.kind==="debt"&&x.kind!=="debt"&&entries.some(p=>p.kind==="payment"&&p.debtId===original.id))return "No cambies el tipo de una deuda con abonos; elimina primero los abonos.";if(x.kind==="debt"){if(!["receivable","payable"].includes(x.direction))return "Selecciona el tipo de deuda.";if(original&&original.kind==="debt"){if(x.amount<pendingDebtPayments(x.id))return "La deuda no puede ser menor que los abonos registrados.";if(x.date>entries.filter(q=>q.kind==="payment"&&q.debtId===x.id).map(q=>q.date).sort()[0]&&entries.some(q=>q.kind==="payment"&&q.debtId===x.id))return "La fecha inicial no puede ser posterior a sus abonos."}}
if(x.kind==="payment"){const d=entries.find(q=>q.id===x.debtId&&q.kind==="debt");if(!d)return "Selecciona una deuda válida.";if(x.date<d.date)return "El abono no puede ser anterior a la deuda.";const paid=entries.filter(q=>q.kind==="payment"&&q.debtId===d.id&&q.id!==x.id).reduce((s,q)=>s+q.amount,0);if(x.amount>d.amount-paid)return "El abono supera el saldo pendiente ("+money(d.amount-paid)+").";}return ""}
async function saveForm(e){e.preventDefault();const kind=$("entryKind").value;const x={id:editing?.id||uid(),created:editing?.created||new Date().toISOString(),kind,amount:Number($("entryAmount").value),date:$("entryDate").value,account:$("entryAccount").value,category:$("entryCategory").value.trim(),description:$("entryDescription").value.trim(),expenseClass:kind==="expense"?$("expenseClass").value:null,direction:kind==="debt"?$("entryDirection").value:null,target:kind==="transfer"?$("entryTarget").value:null,debtId:kind==="payment"?$("entryDebt").value:null};const msg=validEntry(x,editing);if(msg){$("formError").textContent=msg;return}try{await transaction("readwrite",store=>store.put(x));$("entryDialog").close();await refresh();showToast(editing?"Registro actualizado.":"Registro guardado.")}catch(err){$("formError").textContent="Error al guardar: "+err.message}}
async function removeEntry(id){const x=entries.find(q=>q.id===id);if(!x)return;if(x.kind==="debt"&&entries.some(q=>q.kind==="payment"&&q.debtId===id)){showToast("Elimina los abonos antes de borrar esta deuda.");return}if(!confirm("¿Eliminar este registro de "+money(x.amount)+"?"))return;try{await transaction("readwrite",store=>store.delete(id));await refresh();showToast("Registro eliminado.")}catch(e){showToast("No fue posible eliminar.")}}
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200)}
function exportBackup(){const payload={application:"Cash-Control-MiniApp",version:1,exportedAt:new Date().toISOString(),startDate:START,entries};download("CashControl_BR_"+nowBogota()+".json",JSON.stringify(payload,null,2),"application/json");showToast("Copia de seguridad exportada.")}
function exportCsv(){const h=["fecha","tipo","cuenta","destino","direccion_deuda","concepto","valor_COP","descripcion","id_deuda"];const quote=x=>'"'+String(x??"").replace(/"/g,'""')+'"';const lines=[h.join(";"),...entries.map(x=>[x.date,x.kind,x.account,x.target,x.direction,x.category,x.amount,x.description,x.debtId].map(quote).join(";"))];download("CashControl_movimientos_"+nowBogota()+".csv","\ufeff"+lines.join("\r\n"),"text/csv;charset=utf-8");showToast("CSV exportado.")}
function validateBackup(p){if(!p||p.application!=="Cash-Control-MiniApp"||p.version!==1||!Array.isArray(p.entries)||p.entries.length>100000)throw Error("Archivo no compatible.");const seen=new Set();for(const e of p.entries){if(!e||typeof e.id!=="string"||seen.has(e.id)||typeof e.created!=="string"||typeof e.description!=="string"||typeof e.category!=="string"||!["income","expense","transfer","debt","payment","fixed_plan"].includes(e.kind)||!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||e.date<START||!Number.isSafeInteger(e.amount)||(e.kind==="fixed_plan"?e.amount<0:e.amount<=0)||!["digital","cash"].includes(e.account))throw Error("La copia tiene registros inválidos.");if(e.kind==="transfer"&&(!["digital","cash"].includes(e.target)||e.target===e.account))throw Error("Transferencia incorrecta.");if(e.kind==="fixed_plan"&&(!Number.isInteger(e.dueDay)||e.dueDay<1||e.dueDay>31))throw Error("Plan de gasto fijo incorrecto.");if(e.kind==="debt"&&!["receivable","payable"].includes(e.direction))throw Error("Dirección de deuda incorrecta.");seen.add(e.id)}for(const e of p.entries){if(e.kind==="payment"&&!p.entries.some(d=>d.kind==="debt"&&d.id===e.debtId&&d.date<=e.date))throw Error("Abono sin deuda válida.")}for(const d of p.entries.filter(e=>e.kind==="debt"))if(p.entries.filter(e=>e.kind==="payment"&&e.debtId===d.id).reduce((s,x)=>s+x.amount,0)>d.amount)throw Error("Abonos superiores a la deuda.")}
async function importBackup(file){try{if(!file)return;if(file.size>20*1024*1024)throw Error("Archivo demasiado grande.");const p=JSON.parse(await file.text());validateBackup(p);if(!confirm("¿Restaurar "+p.entries.length+" registros? Reemplazará TODOS los datos locales actuales. Exporta antes una copia si deseas conservarlos."))return;await transaction("readwrite",store=>{store.clear();for(const x of p.entries)store.put(x)});month=(nowBogota().slice(0,7) < FIRST_MONTH ? FIRST_MONTH : nowBogota().slice(0,7));await refresh();showToast("Copia restaurada correctamente.")}catch(e){showToast("No se restauró: "+e.message)}finally{$("backupFile").value=""}}
async function eraseAll(){if(!confirm("¿Eliminar TODOS los movimientos, deudas y abonos de ESTE dispositivo?"))return;if(!confirm("Confirmación final: los datos no se pueden recuperar sin una copia JSON."))return;await transaction("readwrite",store=>store.clear());month=(nowBogota().slice(0,7) < FIRST_MONTH ? FIRST_MONTH : nowBogota().slice(0,7));await refresh();showToast("Datos locales eliminados.")}

/* FUNCIONES AVANZADAS · edición local independiente */
let categoryKind="income",conceptSelection=null,fixedEditing=null,quickPayPlanId=null,quickPaySaving=false;
const categoryNames={income:"Ingresos",variable:"Gastos variables",fixed:"Gastos fijos",receivable:"Deudas a favor",payable:"Deudas en contra"};
const categoryColors=["#65bda0","#eead80","#8b9dcc","#b9a0d8","#d77d75","#a3bb6f","#5f97ae"];
function fixedPlans(period){
 const byName=new Map();
 for(const x of entries.filter(x=>x.kind==="fixed_plan"&&x.date.slice(0,7)<=period).sort((a,b)=>a.date.localeCompare(b.date)||a.created.localeCompare(b.created))){
   byName.set(x.category.toLocaleLowerCase("es-CO"),x);
 }
 return [...byName.values()].sort((a,b)=>a.dueDay-b.dueDay||a.category.localeCompare(b.category));
}
function paidFixed(period,cat){
 return entries.filter(x=>x.kind==="expense"&&x.expenseClass==="fixed"&&x.date.slice(0,7)===period&&x.category.toLocaleLowerCase("es-CO")===cat.toLocaleLowerCase("es-CO")).reduce((s,x)=>s+x.amount,0);
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
  for(const x of entries.filter(x=>x.kind==="expense"&&x.expenseClass!=="fixed"))add(x.category,0);
  for(const x of periodEntries.filter(x=>x.kind==="expense"&&x.expenseClass!=="fixed"))add(x.category,x.amount);
 }else{
  for(const d of entries.filter(x=>x.kind==="debt"&&x.direction===kind&&x.date<=month+"-31"))add(d.category,debtBalance(d,month+"-31"));
 }
 return [...result].map(([label,amount])=>({label,amount})).sort((a,b)=>b.amount-a.amount||a.label.localeCompare(b.label));
}
function enhancedRender(s){
 const plans=eligiblePlans(),fixedPaid=entries.filter(x=>x.kind==="expense"&&x.expenseClass==="fixed"&&x.date.slice(0,7)===month).reduce((a,x)=>a+x.amount,0);
 const planned=plans.reduce((a,p)=>a+p.amount,0);
 const upcoming=plans.filter(p=>p.status!=="paid"&&p.amount>0).sort((a,b)=>a.due.localeCompare(b.due)||a.category.localeCompare(b.category)).slice(0,3);
 $("fixedPaid").textContent=money(fixedPaid);
 $("fixedAlerts").classList.toggle("hidden",!upcoming.length);
 $("alertItems").innerHTML=upcoming.map(p=>{
   const dueLabel=p.status==="overdue"?"Vencido":p.days===0?"Vence hoy":p.days===1?"Vence mañana":p.days>1?"Faltan "+p.days+" días":"Vence "+niceDate(p.due);
   return '<button type="button" class="alert-row" data-due="'+safe(p.id)+'" aria-label="Registrar pago de '+safe(p.category)+', '+money(p.amount)+'"><span class="alert-date">'+p.due.slice(-2)+'</span><span><strong>'+safe(p.category)+'</strong><small>'+safe(dueLabel)+' · '+niceDate(p.due)+'</small></span><b>'+money(p.amount)+'</b></button>';
 }).join("");
 const items=categoryItems(categoryKind),total=items.reduce((a,x)=>a+x.amount,0),max=Math.max(1,...items.map(x=>x.amount));
 $("categoryMetricLabel").textContent=categoryKind==="fixed"?"Total pagado":categoryKind==="payable"||categoryKind==="receivable"?"Saldo pendiente":"Total del mes";
 $("categoryMetricTotal").textContent=money(total);$("categoryMetricCount").textContent=String(items.length);
 $("categoryTabs").querySelectorAll("button").forEach(b=>b.classList.toggle("active",b.dataset.category===categoryKind));
 $("categoryChart").innerHTML=items.length?items.filter(x=>x.amount>0).slice(0,12).map((x,i)=>'<div class="category-line"><div class="category-row"><span>'+safe(x.label)+'</span><strong>'+money(x.amount)+'</strong></div><div class="bar-track"><div class="bar-fill" style="width:'+Math.round(100*x.amount/max)+'%;background:'+categoryColors[i%categoryColors.length]+'"></div></div></div>').join("")||empty("Todavía no hay valores registrados este mes."):empty("Esta sección no tiene conceptos registrados.");
 $("categoryRows").innerHTML=items.length?items.map(x=>{
  const plan=categoryKind==="fixed"?plans.find(p=>p.category===x.label):null;
  const due=plan?'<span class="concept-small">Día '+plan.dueDay+' · Previsto '+money(plan.amount)+' · '+(plan.status==="paid"?"Pagado":plan.status==="overdue"?"Vencido":plan.status==="urgent"?"Próximo":"Pendiente")+'</span>':"";
  return '<div class="concept-item"><button class="concept-name" data-concept="'+safe(x.label)+'"><strong>'+safe(x.label)+'</strong>'+due+'<small>Ver y editar registros</small></button><div class="concept-right"><strong>'+money(x.amount)+'</strong>'+(plan?'<button class="mini-btn" data-plan="'+safe(plan.id)+'">Configurar</button>':"")+'</div></div>';
 }).join(""):empty("Agrega tu primer concepto desde el botón +.");
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
 e.preventDefault();const category=$("fixedName").value.trim(),amount=Number($("fixedAmount").value),day=Number($("fixedDay").value),from=$("fixedFrom").value;
 if(!category||!Number.isSafeInteger(amount)||amount<0||!Number.isInteger(day)||day<1||day>31||!/^20\d\d-(0[1-9]|1[0-2])$/.test(from)||from<FIRST_MONTH){$("fixedFormError").textContent="Revisa el concepto, el importe, el día (1-31) y el mes inicial.";return}
 const existing=entries.find(x=>x.kind==="fixed_plan"&&x.id!==fixedEditing?.id&&x.category.toLocaleLowerCase("es-CO")===category.toLocaleLowerCase("es-CO")&&x.date.slice(0,7)===from);
 if(existing){$("fixedFormError").textContent="Ya existe un plan con este concepto y mes. Edítalo en lugar de duplicarlo.";return}
 const item={id:fixedEditing?.id||uid(),kind:"fixed_plan",created:fixedEditing?.created||new Date().toISOString(),date:from+"-01",account:"digital",category,description:"",amount,dueDay:day};
 await transaction("readwrite",store=>store.put(item));$("fixedDialog").close();await refresh();showToast("Gasto fijo guardado.");
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
 quickPaySaving=true;$("confirmQuickPay").disabled=true;
 try{
  await transaction("readwrite",store=>store.put(item));
  $("quickPayDialog").close();quickPayPlanId=null;
  await refresh();showToast("Pago registrado. Disponible actualizado.");
 }catch(err){$("quickPayError").textContent="No se pudo guardar: "+err.message}
 finally{quickPaySaving=false;$("confirmQuickPay").disabled=false}
}
function relatedTo(kind,label){
 return entries.filter(x=>{if(kind==="income")return x.kind==="income"&&x.category===label&&x.date.slice(0,7)===month;
 if(kind==="variable"||kind==="fixed")return x.kind==="expense"&&(kind==="fixed"?x.expenseClass==="fixed":x.expenseClass!=="fixed")&&x.category===label&&x.date.slice(0,7)===month;
 return x.kind==="debt"&&x.direction===kind&&x.category===label&&x.date.slice(0,7)<=month});
}
function openConcept(label){
 conceptSelection={kind:categoryKind,label};$("conceptDialogTitle").textContent=label;
 const rows=relatedTo(categoryKind,label),plan=categoryKind==="fixed"?eligiblePlans().find(p=>p.category===label):null;
 $("conceptDetails").innerHTML=(plan?line("Previsto",plan.amount,"Día de pago "+plan.dueDay)+'<button class="small-action danger" data-remove-plan="'+safe(plan.id)+'">Eliminar plan recurrente</button>':"")+(rows.length?rows.map(x=>'<div class="concept-item"><div class="concept-name"><strong>'+niceDate(x.date)+'</strong><small>'+safe(x.description||kinds[x.kind])+'</small></div><div class="concept-right"><strong>'+money(x.amount)+'</strong><button class="mini-btn" data-concept-edit="'+safe(x.id)+'">Editar</button></div></div>').join(""):empty("Aún no hay movimientos de este concepto en el mes seleccionado."));
 $("conceptDialog").showModal();
}
async function renameSelected(){
 if(!conceptSelection)return;const {kind,label}=conceptSelection;
 const next=prompt("Nuevo nombre para "+label,label)?.trim();if(!next||next===label)return;
 const changing=entries.filter(x=>kind==="income"?x.kind==="income"&&x.category===label:kind==="variable"?x.kind==="expense"&&x.expenseClass!=="fixed"&&x.category===label:kind==="fixed"?(x.kind==="fixed_plan"||x.kind==="expense"&&x.expenseClass==="fixed")&&x.category===label:x.kind==="debt"&&x.direction===kind&&x.category===label);
 const elsewhere=entries.some(x=>x.category?.toLocaleLowerCase("es-CO")===next.toLocaleLowerCase("es-CO")&&x.category!==label&&changing.some(y=>y.kind===x.kind));
 if(elsewhere){showToast("Ya existe otro concepto con ese nombre.");return}
 await transaction("readwrite",store=>{for(const x of changing)store.put({...x,category:next})});
 $("conceptDialog").close();await refresh();showToast("Concepto renombrado.");
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
 const latest=entries.filter(x=>x.kind!=="fixed_plan").slice().sort((a,b)=>b.created.localeCompare(a.created))[0];
 if(!latest){showToast("No hay registros para deshacer.");return}
 if(latest.kind==="debt"&&entries.some(p=>p.kind==="payment"&&p.debtId===latest.id)){showToast("Elimina primero los abonos de esta deuda.");return}
 if(!confirm("¿Deshacer el último registro: "+recordTitle(latest)+" · "+money(latest.amount)+"?"))return;
 await transaction("readwrite",store=>store.delete(latest.id));await refresh();showToast("Último registro deshecho.");
}
function enhancedBind(){
 $("undoLatest").addEventListener("click",undoLatest);
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
 $("categoryAddBtn").addEventListener("click",()=>{if(categoryKind==="fixed")openFixed();else if(categoryKind==="receivable"||categoryKind==="payable"){openForm("debt");$("entryDirection").value=categoryKind;}else openForm(categoryKind==="income"?"income":"expense");if(categoryKind==="variable")$("expenseClass").value="variable"});
 $("fixedForm").addEventListener("submit",saveFixed);
 $("closeFixedDialog").addEventListener("click",()=>$("fixedDialog").close());
 $("cancelFixed").addEventListener("click",()=>$("fixedDialog").close());
 $("closeConceptDialog").addEventListener("click",()=>$("conceptDialog").close());
 $("renameConcept").addEventListener("click",renameSelected);
 $("deleteConcept").addEventListener("click",deleteSelected);
 document.addEventListener("click",async e=>{
  const b=e.target.closest("[data-plan],[data-due],[data-concept],[data-concept-edit],[data-remove-plan]");if(!b)return;
  if(b.dataset.removePlan){const plan=entries.find(x=>x.id===b.dataset.removePlan);if(plan&&confirm("¿Eliminar la programación recurrente de "+plan.category+"? Los pagos ya registrados se conservarán.")){await transaction("readwrite",store=>store.delete(plan.id));$("conceptDialog").close();await refresh();showToast("Plan recurrente eliminado.");}}
  else if(b.dataset.plan){openFixed(entries.find(x=>x.id===b.dataset.plan))}
  else if(b.dataset.due){payDue(b.dataset.due)}
  else if(b.dataset.concept){openConcept(b.dataset.concept)}
  else if(b.dataset.conceptEdit){$("conceptDialog").close();const x=entries.find(x=>x.id===b.dataset.conceptEdit);if(x)openForm(x.kind,x)}
 });
}

function bind(){
 document.querySelectorAll("[data-nav]").forEach(x=>x.addEventListener("click",()=>navigate(x.dataset.nav)));
 $("openMoreMenu").addEventListener("click",()=>{$("moreSheet").classList.contains("hidden")?openMoreSheet():closeMoreSheet()});
 $("closeMoreMenu").addEventListener("click",closeMoreSheet);
 $("sheetBackdrop").addEventListener("click",closeMoreSheet);
 document.querySelectorAll("[data-sheet-nav]").forEach(x=>x.addEventListener("click",()=>navigate(x.dataset.sheetNav)));
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("moreSheet").classList.contains("hidden"))closeMoreSheet()});
$("settingsButton").addEventListener("click",()=>navigate("settings"));$("prevMonth").addEventListener("click",()=>moveMonth(-1));$("nextMonth").addEventListener("click",()=>moveMonth(1));$("filterKind").addEventListener("change",render);$("fab").addEventListener("click",()=>openForm());$("newDebtBtn").addEventListener("click",()=>openForm("debt"));$("entryKind").addEventListener("change",adjustForm);$("entryDate").addEventListener("change",()=>{if($("entryKind").value==="payment")populateDebtOptions(editing?.kind==="payment"?editing.id:null)});$("entryAccount").addEventListener("change",()=>{if($("entryKind").value==="transfer")$("entryTarget").value=$("entryAccount").value==="digital"?"cash":"digital"});$("entryForm").addEventListener("submit",saveForm);$("closeDialog").addEventListener("click",()=>$("entryDialog").close());$("cancelEntry").addEventListener("click",()=>$("entryDialog").close());document.addEventListener("click",e=>{const b=e.target.closest("[data-edit],[data-delete],[data-pay]");if(!b)return;if(b.dataset.edit){const x=entries.find(z=>z.id===b.dataset.edit);if(x)openForm(x.kind,x)}else if(b.dataset.delete)removeEntry(b.dataset.delete);else if(b.dataset.pay)openForm("payment",null,b.dataset.pay)});$("exportBackup").addEventListener("click",exportBackup);$("exportCsv").addEventListener("click",exportCsv);$("importBackup").addEventListener("click",()=>$("backupFile").click());$("backupFile").addEventListener("change",e=>importBackup(e.target.files?.[0]));$("eraseData").addEventListener("click",eraseAll);enhancedBind()}
async function init(){try{db=await openDB();month=(nowBogota().slice(0,7) < FIRST_MONTH ? FIRST_MONTH : nowBogota().slice(0,7));bind();navigate("dashboard");await refresh();if("serviceWorker"in navigator&&location.protocol==="https:")navigator.serviceWorker.register("./sw.js").catch(()=>{});if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{})}catch(err){document.querySelector("main").innerHTML='<div class="panel empty-small">No se pudo iniciar Cash Control. Revisa la fecha del dispositivo y vuelve a cargar la aplicación.<br>'+safe(err.message)+'</div>';document.querySelector(".fab").hidden=true;console.error(err)}}
init();
})();