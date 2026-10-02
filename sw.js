const CACHE = 'job-reminder-v4';
const FILES = ['./', 'index.html', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => clients.claim()));
});
// অফলাইনে চলার জন্য: আগে ক্যাশ থেকে দেখায়, নেট থাকলে পেছনে আপডেট করে রাখে
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => {
      const net = fetch(e.request).then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      }).catch(() => hit || caches.match('index.html'));
      return hit || net;
    })
  );
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(l => l.length ? l[0].focus() : clients.openWindow('./')));
});

// ---- ব্যাকগ্রাউন্ড রিমাইন্ডার চেক (Periodic Background Sync) ----
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('jr', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbGet = async k => { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); };
const idbSet = async (k, v) => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); };

const bn = n => Number(n).toLocaleString('bn-BD');
const day0 = s => new Date(s + 'T00:00:00');
const today0 = () => new Date(new Date().setHours(0, 0, 0, 0));
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x };
const diffDays = (a, b) => Math.round((a - b) / 864e5);
const withTime = (d, t) => { const [h, m] = t.split(':'); const x = new Date(d); x.setHours(+h, +m, 0, 0); return x };
const fmtDate = s => day0(s).toLocaleDateString('bn-BD', { day: 'numeric', month: 'short', year: 'numeric' });

function schedule(j, cfg) {
  const s = day0(j.start), e = day0(j.end);
  let first = addDays(s, 1); if (first > e) first = e;
  const out = [];
  for (let d = new Date(first); d <= e; d = addDays(d, 1)) {
    if (diffDays(e, d) <= 7 || diffDays(d, first) % 2 === 0) out.push(withTime(d, cfg.m), withTime(d, cfg.e));
  }
  return out;
}

async function check() {
  const data = await idbGet('data');
  if (!data || !data.jobs) return;
  const fired = (await idbGet('fired')) || {};
  const now = new Date();
  for (const j of data.jobs.filter(x => !x.applied)) {
    const due = schedule(j, data.cfg).filter(t => t <= now);
    if (!due.length) continue;
    const latest = due[due.length - 1], key = j.id + '_' + latest.getTime();
    if (fired[key]) continue;
    due.forEach(t => fired[j.id + '_' + t.getTime()] = 1);
    if (day0(j.end) < today0()) continue;
    const left = diffDays(day0(j.end), today0());
    const when = left === 0 ? 'আজই শেষ দিন!' : `আর ${bn(left)} দিন বাকি`;
    await self.registration.showNotification('আবেদন করুন: ' + j.name, { body: `${when} — শেষ তারিখ ${fmtDate(j.end)}`, tag: key, icon: 'icon-192.png', badge: 'icon-192.png' });
  }
  await idbSet('fired', fired);
}
self.addEventListener('periodicsync', e => { if (e.tag === 'check-reminders') e.waitUntil(check()); });
