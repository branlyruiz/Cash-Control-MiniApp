/* Cash Control V17 — presentation only. Financial records remain in app.js. */
'use strict';
window.CashUI=(()=>{
 const $=id=>document.getElementById(id),all=s=>[...document.querySelectorAll(s)];
 const paths={sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',back:'<path d="m14 5-7 7 7 7"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',income:'<path d="M18 6 6 18M6 7v11h11"/>',expense:'<path d="M6 18 18 6M7 6h11v11"/>',transfer:'<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',debt:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6m-6 4h6m-6 4h3"/>',payment:'<path d="m5 12 4 4L19 6"/>',wallet:'<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 8h18m0 4h-6v4h6"/>',plus:'<path d="M12 5v14M5 12h14"/>'};
 const icon=name=>'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||paths.debt)+'</svg>';
 const tabs=['dashboard','movements','categories','more'];
 let active='dashboard',routes=Object.fromEntries(tabs.map(t=>[t,[{name:t,scroll:0}]])),config={},ready=false,toastTimer,oldNumbers=new Map(),oldRows=new Map(),theme='system',reduce=false;
 const dialogs=new Map(),savingLabels=new Map(),disabledFields=new Map();
 const state=()=>routes[active].at(-1);
 const storePosition=()=>{state().scroll=window.scrollY;state().focus=document.activeElement?.id||null};
 const snapshot=()=>({cashUI:true,active,routes:JSON.parse(JSON.stringify(routes))});
 function persistNav(replace=false){try{history[replace?'replaceState':'pushState'](snapshot(),'')}catch{}}
 function paint(direction=''){
  const route=state();all('.view').forEach(el=>el.classList.toggle('active',el.id===route.name+'View'));
  config.onView?.(route.name);const page=$(route.name+'View');
  if(route.name==='detail')config.detail?.(route.id);
  all('.dock-item').forEach((b,i)=>{const chosen=tabs[i]===active;b.classList.toggle('active',chosen);if(chosen)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
  document.querySelector('.dock-indicator').style.transform='translateX('+tabs.indexOf(active)*100+'%)';
  all('.ui-back').forEach(b=>b.hidden=true);if(page&&routes[active].length>1)page.querySelector('.ui-back').hidden=false;
  window.scrollTo({top:route.scroll||0,behavior:'instant'});
  if(direction){Motion.page(page,direction==='back');page?.querySelector('h2')?.focus({preventScroll:true})}
 }
 function navigate(name,id){
  if(!ready)return;storePosition();const tab=tabs.includes(name);
  if(tab){active=name;paint();}else{if(state().name!==name||state().id!==id)routes[active].push({name,id,scroll:0});paint('forward')}
  persistNav();
 }
 function back(){if(routes[active].length<2)return;routes[active].pop();paint('back');persistNav(true);const f=state().focus;if(f)$(f)?.focus({preventScroll:true})}
 function settings(){document.documentElement.dataset.theme=theme==='system'?(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'):theme;document.documentElement.dataset.reduce=String(reduce);document.querySelector('meta[name="theme-color"]').content=document.documentElement.dataset.theme==='dark'?'#0f1916':'#f4f6f5';all('[data-theme-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.themeChoice===theme)));if($('reduceMotion'))$('reduceMotion').checked=reduce}
 function saveSettings(){try{localStorage.setItem('cash-control-ui-preferences',JSON.stringify({theme,reduce}))}catch{}settings()}
 function draft(d){return JSON.stringify([...d.querySelectorAll('input,select,textarea')].filter(el=>el.type!=='file').map(el=>[el.id,el.value,el.checked]))}
 function requestClose(d){if(d.dataset.saving==='true')return;const info=dialogs.get(d);if(info&&draft(d)!==info.draft&&!confirm('¿Salir sin guardar? Los cambios de este formulario se perderán.'))return;Motion.sheet(d,true).then(()=>{if(d.open&&d.dataset.saving!=='true')d.close()})}
 function setupDialog(d){
  const nativeOpen=d.showModal.bind(d),nativeClose=d.close.bind(d);
  const h=d.querySelector('h2');if(h){h.tabIndex=-1;if(!h.id)h.id=d.id+'Title';d.setAttribute('aria-labelledby',h.id)}
  if(!d.querySelector('.sheet-grabber')){const handle=document.createElement('div');handle.className='sheet-grabber';handle.setAttribute('aria-hidden','true');(d.querySelector('form')||d).prepend(handle)}
  d.showModal=function(){const wasOpen=d.open;nativeOpen();if(wasOpen)return;dialogs.set(d,{draft:draft(d),origin:document.activeElement});Motion.sheet(d);queueMicrotask(()=>{const info=dialogs.get(d);if(info)info.draft=draft(d);h?.focus({preventScroll:true})})};
  // Origin must be saved before the browser moves focus into its native dialog.
  const wrapped=d.showModal;d.showModal=function(){const origin=document.activeElement;wrapped();const info=dialogs.get(d);if(info)info.origin=origin};
  d.close=function(...args){nativeClose(...args);const info=dialogs.get(d);dialogs.delete(d);delete d.dataset.saving;if(d.contains($('toast')))document.body.append($('toast'));requestAnimationFrame(()=>{if(document.querySelector('dialog[open]'))return;if(info?.origin?.isConnected)info.origin.focus({preventScroll:true});else document.querySelector('.view.active h2')?.focus({preventScroll:true})})};
  d.addEventListener('cancel',e=>{e.preventDefault();e.stopImmediatePropagation();requestClose(d)},true);
  d.addEventListener('click',e=>{const b=e.target.closest('button');if(b&&(b.classList.contains('close')||/^cancel/.test(b.id))){e.preventDefault();e.stopImmediatePropagation();requestClose(d);return}if(e.target===d){const r=d.getBoundingClientRect();if(e.clientY<r.top||e.clientY>r.bottom||e.clientX<r.left||e.clientX>r.right)requestClose(d)}},true);
  let start=0;const handle=d.querySelector('.sheet-grabber');handle.addEventListener('pointerdown',e=>{start=e.clientY;handle.setPointerCapture(e.pointerId)});handle.addEventListener('pointerup',e=>{if(e.clientY-start>70)requestClose(d)});
  d.addEventListener('input',e=>e.target.removeAttribute('aria-invalid'));
 }
 function saving(formId,value){const form=$(formId);if(!form)return;const d=form.closest('dialog'),btn=form.querySelector('[type="submit"]');if(!btn)return;d.dataset.saving=String(value);form.setAttribute('aria-busy',String(value));if(value){disabledFields.set(formId,[...form.querySelectorAll("input,select,textarea,button")].filter(e=>e!==btn).map(e=>[e,e.disabled]));disabledFields.get(formId).forEach(([e])=>e.disabled=true);savingLabels.set(formId,btn.textContent);btn.innerHTML='<span class="ui-spinner" aria-hidden="true"></span> Guardando…';}else{btn.textContent=savingLabels.get(formId)||btn.textContent;savingLabels.delete(formId);(disabledFields.get(formId)||[]).forEach(([e,was])=>e.disabled=was);disabledFields.delete(formId)}}
 function toast(msg){const el=$('toast');clearTimeout(toastTimer);el.textContent='';const mark=document.createElement('span');mark.innerHTML=icon(/error|no |revisa|primero/i.test(msg)?'debt':'payment');el.append(mark,document.createTextNode(msg));const d=[...document.querySelectorAll('dialog[open]')].at(-1);(d||document.body).append(el);el.classList.add('show');toastTimer=setTimeout(()=>el.classList.remove('show'),4500)}
 function beforeRender(){Motion.finishCounters();oldNumbers=new Map(all('[data-ui-number]').map(e=>[e.id,e.textContent]));oldRows=Motion.capture(document.querySelector('.view.active')||document.body)}
 function afterRender(){if(!ready)return;if(state().name==='detail')config.detail?.(state().id);
  all('[data-ui-number]').forEach(e=>{if(e.closest('.view.active')&&oldNumbers.has(e.id)&&oldNumbers.get(e.id)!==e.textContent)(['totalBalance','digitalBalance','cashBalance'].includes(e.id)?Motion.counter(e,oldNumbers.get(e.id)):Motion.numbers(e))});
  Motion.reorder(document.querySelector('.view.active'),oldRows);
  all('.transaction-icon[data-icon]').forEach(e=>e.innerHTML=icon(e.dataset.icon));
  all('.empty-small').forEach(el=>{if(!el.querySelector('svg')){const span=document.createElement('span');span.className='empty-icon';span.innerHTML=icon('wallet');el.prepend(span)}});
  all('.view.active .bar-fill').forEach(e=>Motion.chart(e));
  all('.transaction-swipe').forEach(el=>{let x=0,y=0,swiped=false;el.addEventListener('pointerdown',e=>{x=e.clientX;y=e.clientY;swiped=false});el.addEventListener('pointerup',e=>{if(Math.abs(e.clientX-x)>60&&Math.abs(e.clientY-y)<35){swiped=true;el.classList.toggle('actions-open',e.clientX<x);el.querySelector('.quick-actions').inert=e.clientX>=x}});el.addEventListener('click',e=>{if(swiped){swiped=false;e.preventDefault();e.stopPropagation()}},true)});
  all('[data-row-id]').forEach(el=>el.style.willChange='auto');
  $('startupLoading')?.remove();$('appMain').setAttribute('aria-busy','false');
 }
 function init(hooks){config=hooks;try{const prefs=JSON.parse(localStorage.getItem('cash-control-ui-preferences')||'{}');if(['light','dark','system'].includes(prefs.theme))theme=prefs.theme;reduce=prefs.reduce===true}catch{}settings();
  all('.view').forEach(page=>{const b=document.createElement('button');b.className='ui-back';b.type='button';b.hidden=true;b.innerHTML=icon('back')+'<span>Volver</span>';b.addEventListener('click',back);page.prepend(b);page.querySelectorAll('h2').forEach(h=>h.tabIndex=-1)});
  all('.entry-dialog').forEach(setupDialog);
  all('[data-theme-choice]').forEach(b=>b.onclick=()=>{theme=b.dataset.themeChoice;saveSettings()});$('reduceMotion').onchange=e=>{reduce=e.target.checked;saveSettings()};
  matchMedia('(prefers-color-scheme:dark)').addEventListener('change',settings);
  $('settingsButton').innerHTML=icon('sun');$('fab').innerHTML=icon('plus');all('.close').forEach(b=>b.innerHTML=icon('close'));all('[data-ui-icon]').forEach(e=>e.innerHTML=icon(e.dataset.uiIcon));
  all('[data-entry-kind]').forEach(b=>{const span=b.querySelector('span');b.innerHTML=icon(b.dataset.entryKind)+(span?span.outerHTML:'')});
  all('.metric-icon').forEach(e=>e.innerHTML=icon(e.classList.contains('incoming')?'income':'expense'));
  $('openTransfer').onclick=config.transfer;
  $('toggleRowActions').onclick=()=>{all('.transaction-swipe').forEach(el=>{el.classList.toggle('actions-open');el.querySelector('.quick-actions').inert=!el.classList.contains('actions-open')})};
  document.addEventListener('click',e=>{const b=e.target.closest('[data-detail]');if(b){navigate('detail',b.dataset.detail)}});
  document.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const d=[...document.querySelectorAll('dialog[open]')].at(-1);if(!d)return;const controls=[...d.querySelectorAll('button,input,select,textarea,[href]')].filter(el=>!el.disabled&&el.getClientRects().length&&!el.closest('[hidden],.hidden'));const first=controls[0],last=controls.at(-1);if(!first)return;if(e.shiftKey&&(document.activeElement===first||!controls.includes(document.activeElement))){e.preventDefault();last.focus()}else if(!e.shiftKey&&(document.activeElement===last||!d.contains(document.activeElement))){e.preventDefault();first.focus()}},true);
  window.addEventListener('beforeunload',e=>{if([...dialogs].some(([d,s])=>d.open&&draft(d)!==s.draft)){e.preventDefault();e.returnValue=''}});
  window.addEventListener('popstate',e=>{if(e.state?.cashUI){const open=[...document.querySelectorAll('dialog[open]')];if(open.length){const d=open.at(-1);requestClose(d);persistNav();return}active=e.state.active;routes=e.state.routes;paint('back')}});
  ['totalBalance','digitalBalance','cashBalance','incomeTotal','outflowTotal','balanceClosing'].forEach(id=>{if($(id))$(id).dataset.uiNumber=''});
  ready=true;paint();persistNav(true);
 }
 return {init,navigate,beforeRender,afterRender,saving,toast,icon,back,requestClose};
})();
