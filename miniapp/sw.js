const CACHE="cash-control-br-local-2026-11-v17.5";
const FILES=["./","./index.html","./styles.css?v=17.5","./app.js?v=17.5","./experience.js?v=17.5","./motion.js?v=17.5","./manifest.webmanifest","./icon.svg?v=10","./icon-180.png?v=10"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",event=>{if(event.request.method!=="GET"||new URL(event.request.url).origin!==self.location.origin)return;
const url=new URL(event.request.url),fresh=event.request.mode==="navigate"||url.pathname.endsWith("/app.js")||url.pathname.endsWith("/styles.css")||url.pathname.endsWith("/experience.js")||url.pathname.endsWith("/motion.js");
if(fresh){event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{})}return response}).catch(()=>caches.match(event.request).then(r=>r||caches.match("./index.html"))));return}
event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{})}return response})))});
