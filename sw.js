'use strict';
/*
  Registro Scienze Motorie: service worker per l'uso offline.

  - All'installazione salva in cache la pagina dell'app, il manifest e le icone.
  - Poi serve sempre dalla cache: l'app si apre anche senza connessione.
  - A ogni apertura, se c'è rete, controlla in background se la pagina è cambiata.
    Se è cambiata aggiorna la cache e avvisa l'app, che propone di ricaricare.
    Non serve quindi modificare questo file a ogni nuova versione dell'app.
  - Non fa richieste verso altri domini: quelle dirette ad altri indirizzi vengono rifiutate.
  - Non tocca i dati degli studenti: questi stanno nel database del browser, non nella cache.

  Modifica VERSION solo se cambia questo file (cambia anche il nome della cache).
*/
const VERSION = 'M9';
const CACHE = 'rsm-cache-' + VERSION;
const PAGE = './';
const ASSETS = [
  './manifest.json',
  './icon-192.png', './icon-512.png',
  './icon-maskable-192.png', './icon-maskable-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // La pagina è indispensabile: se non si scarica, l'installazione fallisce e si riprova alla visita successiva.
    await cache.add(new Request(PAGE, { cache: 'reload' }));
    // Manifest e icone sono accessori: un'assenza non deve bloccare l'installazione.
    await Promise.allSettled(ASSETS.map(u => cache.add(new Request(u, { cache: 'reload' }))));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('rsm-cache-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    event.respondWith(Response.error());   // l'app non deve contattare altri domini
    return;
  }
  event.respondWith(handle(req, event));
});

async function handle(req, event) {
  const cache = await caches.open(CACHE);
  const isPage = req.mode === 'navigate';
  const cached = await cache.match(isPage ? PAGE : req, { ignoreSearch: true });
  if (cached) {
    if (isPage) event.waitUntil(refreshPage(cache).then(r => { if (r === 'updated') return notify({ type: 'APP_UPDATED' }); }));
    return cached;
  }
  try {
    return await fetch(req);
  } catch (e) {
    return Response.error();   // offline e file mai salvato
  }
}

/** Confronta la pagina in rete con quella in cache. Restituisce 'updated', 'same' oppure 'offline'. */
async function refreshPage(cache) {
  try {
    const res = await fetch(PAGE, { cache: 'no-cache' });
    if (!res.ok) return 'offline';
    const fresh = await res.clone().text();
    const old = await cache.match(PAGE);
    const oldText = old ? await old.text() : null;
    if (fresh === oldText) return 'same';
    await cache.put(PAGE, res);
    return 'updated';
  } catch (e) {
    return 'offline';
  }
}

async function notify(msg, only) {
  const targets = only ? [only] : await self.clients.matchAll({ type: 'window' });
  targets.forEach(c => c.postMessage(msg));
}

self.addEventListener('message', event => {
  const d = event.data || {};
  if (d.type === 'SKIP_WAITING') self.skipWaiting();
  if (d.type === 'CHECK_UPDATE') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      const r = await refreshPage(cache);
      await notify({ type: r === 'updated' ? 'APP_UPDATED' : r === 'same' ? 'UP_TO_DATE' : 'OFFLINE' }, event.source);
    })());
  }
});
