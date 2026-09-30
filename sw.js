// =========================================
// タイムカード：電波が無くても画面を開けるようにする（Service Worker）
//
// 以前は、ブラウザが一時的に覚えている画面（10分で期限切れ）が
// たまたま残っているときだけ、電波が無くても開けていた。
// アプリを閉じて開き直すと、電波が無い場所では起動できなくなる（2026-09-30）。
//
// ここで画面（index.html）を端末にしまっておき、
//   ・電波があるとき … 最新の画面を取りに行き、しまっておく版も更新する
//   ・電波が無い／遅いとき … しまっておいた版で起動する
// とする。
//
// ★打刻の送信（スプレッドシートへの送信）には一切さわらない。
//   別のサイト（script.google.com）への通信は素通しにしている。
// ★画面を直したら CACHE の番号を1つ上げる必要はない
//   （いつも「まずネット」なので、電波があれば最新版に入れ替わる）。
// =========================================
const CACHE = 'timecard-app-v2';   // index.html の SW_CACHE と同じ名前にすること
const APP_SHELL = ['./', './index.html'];
const NET_TIMEOUT_MS = 4000;   // これ以上待っても返事が無ければ、しまっておいた版を出す

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // 打刻の送信（POST）は触らない
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // スプレッドシート等への通信は触らない

  e.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);

  const fromNet = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());       // 最新版をしまい直す
    return res;
  });

  // ネットが返事をしない（電波が弱い）ときに、ずっと待たせない
  const timeout = new Promise((resolve) => setTimeout(resolve, NET_TIMEOUT_MS, null));

  try {
    const res = await Promise.race([fromNet, timeout]);
    if (res) return res;
  } catch (err) {
    // 電波が無い → 下でしまっておいた版を出す
  }

  const opt = { ignoreSearch: true, ignoreVary: true };
  const saved = (await cache.match(req, opt)) ||
                // 画面を開く要求なら、アドレスが少し違っても（/timecard/ と /timecard/index.html 等）同じ画面を出す
                (req.mode === 'navigate' ? ((await cache.match('./', opt)) || (await cache.match('./index.html', opt))) : null);
  if (saved) return saved;

  // しまっておいた版も無い（初めて開いたのが電波の無い場所）ときは、ネットを待つしかない
  return fromNet;
}
