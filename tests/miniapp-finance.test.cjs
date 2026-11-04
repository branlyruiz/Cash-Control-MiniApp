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
 function el(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',disabled:false,classList:{add(){},remove(){},toggle(){}},contains(){return false},close(){},querySelectorAll(){return []}});return elements.get(id)}
 const sandbox={Intl,Date,Math,Number,String,Map,Set,Promise,crypto:{randomUUID},console,setTimeout:()=>0,clearTimeout(){},document:{getElementById:el,activeElement:null,querySelectorAll:()=>[]}};
 vm.createContext(sandbox);
 const hooks=`
 globalThis.api={
  configure(records){entries=records.slice();globalThis.saved=new Map(records.map(x=>[x.id,x]));transaction=async(mode,fn)=>fn({put:x=>globalThis.saved.set(x.id,x),delete:id=>globalThis.saved.delete(id)});refresh=async()=>{entries=[...globalThis.saved.values()]};},
  edit(record){editing=record},saveForm,accountBalance,categoryItems,debtBalance,debtsAvailable,summary,validEntry,validateBackup,
  setMonth(value){month=value},getEntries(){return entries}
 };
 `;
 vm.runInContext(source.replace('\ninit();','\n'+hooks),sandbox);
 const api=sandbox.api;api.configure(records);
 for(const [id,value] of Object.entries({entryKind:'payment',entryAmount:'',entryDate:'2026-11-04',entryAccount:'digital',entryCategory:'',entryDescription:'',debtAction:'settle'}))el(id).value=value;
 return {api,el,setForm(values){for(const [id,value] of Object.entries(values))el(id).value=value}};
}
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
