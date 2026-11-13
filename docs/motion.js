/* Isolated presentation primitives. Never receives or writes financial records. */
window.Motion = (() => {
 const timings = {micro:160, content:220, modal:280};
 const curves = {enter:'cubic-bezier(.2,.8,.2,1)', exit:'cubic-bezier(.4,0,1,1)', settle:'cubic-bezier(.2,.85,.25,1)'};
 const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reduce === 'true';
 function run(el,frames,duration=timings.content,easing=curves.enter){if(!el||reduced())return Promise.resolve();return el.animate(frames,{duration,easing}).finished.catch(()=>{})}
 function page(el,back=false){return run(el,[{opacity:.4,transform:`translateX(${back?-20:24}px)`},{opacity:1,transform:'translateX(0)'}])}
 function sheet(el,close=false){return run(el,close?[{opacity:1,transform:'translateY(0) scale(1)'},{opacity:0,transform:'translateY(18px) scale(.985)'}]:[{opacity:0,transform:'translateY(24px) scale(.985)'},{opacity:1,transform:'translateY(0) scale(1)'}],close?180:timings.modal,close?curves.exit:curves.enter)}
 function numbers(el){return run(el,[{opacity:.3,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],timings.content)}
 const counters=new Map();
 const currency=new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0});
 function amount(text){return Number(String(text||'0').replace(/[^0-9−-]/g,'').replace('−','-'))}
 function finishCounters(){for(const [el,state] of counters){cancelAnimationFrame(state.frame);el.textContent=state.final}counters.clear()}
 function counter(el,previous){
  const final=el.textContent,to=amount(final),from=amount(previous);
  const old=counters.get(el);if(old)cancelAnimationFrame(old.frame);
  counters.delete(el);el.setAttribute('aria-label',final);
  if(reduced()||!Number.isFinite(to)||!Number.isFinite(from)||to===from){el.textContent=final;return}
  const state={final,frame:0},start=performance.now();counters.set(el,state);
  function tick(now){
   if(counters.get(el)!==state)return;
   const t=Math.min(1,(now-start)/600);
   if(t>=1||reduced()||!el.closest('.view.active')){el.textContent=final;counters.delete(el);return}
   el.textContent=currency.format(Math.round(from+(to-from)*(1-Math.pow(1-t,3))));
   state.frame=requestAnimationFrame(tick);
  }
  el.textContent=currency.format(from);state.frame=requestAnimationFrame(tick);
 }
 function chart(el){return run(el,[{transform:'scaleX(.96)',opacity:.6},{transform:'scaleX(1)',opacity:1}],240)}
 function capture(root){return new Map([...root.querySelectorAll('[data-row-id]')].map(e=>[e.dataset.rowId,e.getBoundingClientRect().top]))}
 function reorder(root,before){root.querySelectorAll('[data-row-id]').forEach(el=>{const y=before.get(el.dataset.rowId);if(y!==undefined)run(el,[{transform:`translateY(${y-el.getBoundingClientRect().top}px)`},{transform:'translateY(0)'}],240,curves.settle)})}
 function expand(el){return run(el,[{opacity:0,transform:'translateY(-4px)'},{opacity:1,transform:'translateY(0)'}],200)}
 return {counter,finishCounters,timings,curves,reduced,run,page,sheet,numbers,chart,capture,reorder,expand};
})();
