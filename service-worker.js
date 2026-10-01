/* V2.3: deliberately network-only; never cache CPR records or Supabase requests. */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
    if(event.request.method!=='GET' || new URL(event.request.url).origin!==self.location.origin)return;
    // Let connectivity failures follow the existing app's offline behavior; no synthetic records.
    event.respondWith(fetch(event.request));
});
