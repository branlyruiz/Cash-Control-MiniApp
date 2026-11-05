const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');
const source=fs.readFileSync('docs/app.js','utf8');
const event={preventDefault(){}};
const base=(id,kind,amount,more={})=>({id,kind,amount,date:'2026-11-03',created:'2026-11-03T12:00:00Z',account:'digital',category:'Prueba '+id,description:'',...more});
const debt=(id,direction,amount=75000)=>base(id,'debt',amount,{direction});
const payment=(id,debtId,amount,more={})=>base(id,'payment',amount,{debtId,...more});
function app(records=[]){
 const elements=new Map();
 function el(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',disabled:false,classList:{add(){},remove(){},toggle(){}},contains(){return false},close(){},focus(){},querySelectorAll(){return []}});return elements.get(id)}
 const sandbox={Intl,Date,Math,Number,String,Map,Set,Promise,crypto:{randomUUID},console,confirm:()=>true,setTimeout:()=>0,clearTimeout(){},document:{getElementById:el,activeElement:null,querySelectorAll:()=>[]}};
 vm.createContext(sandbox);
 const hooks=`
 globalThis.api={
  configure(records){entries=records.slice();globalThis.saved=new Map(records.map(x=>[x.id,x]));transaction=async(mode,fn)=>fn({put:x=>globalThis.saved.set(x.id,x),delete:id=>globalThis.saved.delete(id)});refresh=async()=>{entries=[...globalThis.saved.values()]};},
  edit(record){editing=record},saveForm,accountBalance,categoryItems,debtBalance,debtsAvailable,summary,validEntry,validateBackup,
  setMonth(value){month=value},getEntries(){return entries},debtRows,debtRowHtml,debtPaymentRemaining,saveDebtPayment,
  editFixed(record){fixedEditing=record},saveFixed,removeFixedPlan,eligiblePlans,fixedCategoryRows,
  direct(id,original=null){debtPaymentState={debtId:id,original}}
 };
 `;
 vm.runInContext(source.replace('\ninit();','\n'+hooks),sandbox);
 const api=sandbox.api;api.configure(records);
 for(const [id,value] of Object.entries({entryKind:'payment',entryAmount:'',entryDate:'2026-11-04',entryAccount:'digital',entryCategory:'',entryDescription:'',debtAction:'settle'}))el(id).value=value;
 return {api,el,setForm(values){for(const [id,value] of Object.entries(values))el(id).value=value}};
}

test('los vencimientos pendientes van por fecha efectiva y los pagos quedan después',()=>{
 const plans=[
  base('late','fixed_plan',1000,{dueDay:31}),
  base('soon','fixed_plan',3000,{dueDay:6}),
  base('paid','fixed_plan',2000,{dueDay:1})
 ];
 const paid=base('expense','expense',2000,{category:plans[2].category,expenseClass:'fixed',date:'2027-02-01'});
 const {api}=app([...plans,paid]);
 api.setMonth('2027-02');
 const rows=api.fixedCategoryRows(api.eligiblePlans(),[paid]);
 assert.deepEqual(Array.from(rows,row=>[row.id,row.date]),[
  ['soon','2027-02-06'],['late','2027-02-28'],['paid','2027-02-01']
 ]);
});

test('editar el concepto del plan conserva el pago asociado y su importe',async()=>{
 const plan=base('plan','fixed_plan',60000,{category:'Internet',dueDay:6,date:'2026-11-01'});
 const paid=base('expense','expense',55000,{category:'internet',expenseClass:'fixed'});
 const {api,setForm}=app([plan,paid]);
 api.setMonth('2026-11');
 api.editFixed(plan);
 setForm({fixedName:'Fibra',fixedAmount:'65000',fixedDay:'12',fixedFrom:'2026-11'});
 await api.saveFixed(event);
 const [updated]=api.eligiblePlans();
 assert.equal(updated.category,'Fibra');
 assert.equal(updated.due,'2026-11-12');
 assert.equal(updated.amount,65000);
 assert.equal(updated.status,'paid');
 assert.equal(updated.paid,55000);
 assert.equal(api.accountBalance('2026-11-30').digital,-55000);
});

test('eliminar una recurrencia retira sus versiones y conserva los pagos en la lista',async()=>{
 const plan=base('plan','fixed_plan',60000,{category:'Internet',dueDay:6,date:'2026-11-01'});
 const replacement=base('plan-next','fixed_plan',65000,{category:'INTERNET',dueDay:12,date:'2026-12-01'});
 const paid=base('expense','expense',55000,{category:'Internet',expenseClass:'fixed'});
 const {api}=app([plan,replacement,paid]);
 api.setMonth('2026-12');
 await api.removeFixedPlan(replacement.id);
 assert.equal(api.eligiblePlans().length,0);
 assert.deepEqual(Array.from(api.getEntries(),entry=>entry.id),[paid.id]);
 assert.equal(api.fixedCategoryRows([],[paid])[0].scheduled,false);
});
for(const direction of ['payable','receivable']){
 test(`${direction}: abono y pago total ajustan disponible, resumen y categoría`,async()=>{
  const d=debt('d',direction),initial=base('income','income',200000),{api,el,setForm}=app([initial,d]);
  setForm({entryDebt:'d',entryAmount:'25000',debtAction:'payment'});
  await api.saveForm(event);
  const sign=direction==='payable'?-1:1;
  assert.equal(api.accountBalance('2026-11-30').digital,200000+sign*25000);
  assert.equal(api.categoryItems(direction)[0].amount,50000);
  setForm({debtAction:'settle',entryAmount:'999999'});
  await api.saveForm(event);
  assert.equal(api.accountBalance('2026-11-30').digital,200000+sign*75000);
  assert.equal(api.debtBalance(d),0);
  assert.equal(api.categoryItems(direction).length,0);
  const payments=api.getEntries().filter(x=>x.kind==='payment');
  assert.equal(payments.length,2);assert.equal(payments[1].amount,50000);
  assert.ok(api.getEntries().some(x=>x.id==='d'),'se conserva la deuda original');
  assert.equal(api.summary()[direction==='payable'?'expenses':'income'],direction==='payable'?75000:275000);
  assert.equal(el('formError').textContent,'');
 });
}
test('el pago total usa la cuenta seleccionada y no cambia la otra dirección',async()=>{
 const {api,setForm}=app([debt('a','payable'),debt('b','receivable')]);
 setForm({entryDebt:'a',entryAccount:'cash'});await api.saveForm(event);
 assert.equal(api.accountBalance('2026-11-30').cash,-75000);
 assert.equal(api.accountBalance('2026-11-30').digital,0);
 assert.equal(api.categoryItems('payable').length,0);
 assert.equal(api.categoryItems('receivable')[0].amount,75000);
});
test('editar un abono excluye su importe anterior y permite reabrir la deuda',async()=>{
 const d=debt('d','payable'),first=payment('p1','d',25000),last=payment('p2','d',50000);
 const {api,setForm}=app([d,first,last]);api.edit(last);
 setForm({entryDebt:'d',debtAction:'payment',entryAmount:'30000'});await api.saveForm(event);
 assert.equal(api.categoryItems('payable')[0].amount,20000);
 assert.equal(api.accountBalance('2026-11-30').digital,-55000);
 setForm({debtAction:'settle'});await api.saveForm(event);
 assert.equal(api.getEntries().find(x=>x.id==='p2').amount,50000);
 assert.equal(api.getEntries().length,3);
 assert.equal(api.categoryItems('payable').length,0);
});
test('se rechaza un abono excesivo y no se altera el disponible',async()=>{
 const {api,el,setForm}=app([debt('d','payable'),payment('p','d',50000)]);
 setForm({entryDebt:'d',debtAction:'payment',entryAmount:'26000'});await api.saveForm(event);
 assert.match(el('formError').textContent,/supera el saldo/);
 assert.equal(api.getEntries().length,2);
 assert.equal(api.accountBalance('2026-11-30').digital,-50000);
});
test('dos envíos simultáneos registran un solo pago',async()=>{
 const {api,setForm}=app([debt('d','payable')]);setForm({entryDebt:'d'});
 await Promise.all([api.saveForm(event),api.saveForm(event)]);
 assert.equal(api.getEntries().filter(x=>x.kind==='payment').length,1);
 assert.equal(api.accountBalance('2026-11-30').digital,-75000);
});
test('la categoría refleja el saldo de cada mes y reserva abonos futuros',async()=>{
 const d=debt('d','receivable'),{api,setForm}=app([d,payment('future','d',25000,{date:'2026-12-05'})]);
 assert.equal(api.debtsAvailable('2026-11-04')[0].remaining,50000);
 setForm({entryDebt:'d'});await api.saveForm(event);
 assert.equal(api.accountBalance('2026-11-30').digital,50000);
 assert.equal(api.categoryItems('receivable')[0].amount,25000);
 api.setMonth('2026-12');assert.equal(api.categoryItems('receivable').length,0);
 assert.equal(api.accountBalance('2026-12-31').digital,75000);
});
test('respaldos previos mantienen deudas, transferencias y pagos sin migración',()=>{
 const records=[base('i','income',200000),debt('d','payable'),payment('p','d',25000),base('t','transfer',30000,{target:'cash'})];
 const {api}=app(records);
 assert.doesNotThrow(()=>api.validateBackup({application:'Cash-Control-MiniApp',version:1,entries:records}));
 assert.equal(api.accountBalance('2026-11-30').digital,145000);
 assert.equal(api.accountBalance('2026-11-30').cash,30000);
 assert.equal(api.categoryItems('payable')[0].amount,50000);
});

for(const direction of ['receivable','payable']){
 test(`${direction}: formulario directo guarda un abono y salda solo la deuda elegida`,async()=>{
  const d=debt('a',direction),other=debt('b',direction),{api,el,setForm}=app([d,other]);
  api.direct('a');setForm({debtPaymentAmount:'25000',debtPaymentDate:'2026-11-04',debtPaymentAccount:'cash',debtPaymentNote:'Prueba'});
  await api.saveDebtPayment(event);
  assert.equal(api.debtRows(direction).length,2);
  assert.equal(api.debtRows(direction).find(x=>x.entry.id==='a').remaining,50000);
  api.direct('a');setForm({debtPaymentAmount:String(api.debtPaymentRemaining())});await api.saveDebtPayment(event);
  assert.equal(api.debtRows(direction).length,1);assert.equal(api.debtRows(direction)[0].entry.id,'b');
  assert.equal(api.debtRows(null,'2026-11-30',true).length,1);
  assert.equal(api.accountBalance('2026-11-30').cash,direction==='payable'?-75000:75000);
  assert.equal(el('debtPaymentError').textContent,'');
 });
}
test('formulario directo rechaza sobreabonos y conserva el borrador',async()=>{
 const {api,el,setForm}=app([debt('a','payable')]);api.direct('a');
 setForm({debtPaymentAmount:'75001',debtPaymentDate:'2026-11-04',debtPaymentAccount:'digital',debtPaymentNote:''});
 await api.saveDebtPayment(event);assert.match(el('debtPaymentError').textContent,/supera el saldo/);
 assert.equal(el('debtPaymentAmount').value,'75001');assert.equal(api.getEntries().length,1);
});
test('editar un abono desde el formulario directo excluye el valor anterior',async()=>{
 const d=debt('a','receivable'),p=payment('p','a',25000),{api,setForm}=app([d,p]);api.direct('a',p);
 assert.equal(api.debtPaymentRemaining(),75000);
 setForm({debtPaymentAmount:'40000',debtPaymentDate:'2026-11-04',debtPaymentAccount:'digital',debtPaymentNote:''});await api.saveDebtPayment(event);
 assert.equal(api.getEntries().length,2);assert.equal(api.debtBalance(d),35000);assert.equal(api.accountBalance('2026-11-30').digital,40000);
});
test('las filas mantienen separadas deudas que comparten concepto y escapan su texto',()=>{
 const a=debt('a','payable'),b=debt('b','payable');a.category=b.category='<Cliente & prueba>';
 const {api}=app([a,b]);const rows=api.debtRows('payable');assert.equal(rows.length,2);
 assert.match(api.debtRowHtml(rows[0]),/data-pay="a"/);assert.match(api.debtRowHtml(rows[1]),/data-pay="b"/);
 assert.doesNotMatch(api.debtRowHtml(rows[0]),/<Cliente/);assert.match(api.debtRowHtml(rows[0]),/&lt;Cliente &amp; prueba&gt;/);
});
test('el formulario directo protege contra doble envío',async()=>{
 const {api,setForm}=app([debt('a','payable')]);api.direct('a');
 setForm({debtPaymentAmount:'75000',debtPaymentDate:'2026-11-04',debtPaymentAccount:'digital',debtPaymentNote:''});
 await Promise.all([api.saveDebtPayment(event),api.saveDebtPayment(event)]);
 assert.equal(api.getEntries().filter(x=>x.kind==='payment').length,1);assert.equal(api.accountBalance('2026-11-30').digital,-75000);
});
