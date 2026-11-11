const ADBLOCK_PATTERNS = [
    "googlesyndication.com",
    "googleadservices.com",
    "doubleclick.net",
    "adnxs.com",
    "amazon-adsystem.com",
    "rubiconproject.com",
    "pubmatic.com",
    "criteo.com",
    "openx.net",
    "taboola.com",
    "outbrain.com",
    "moatads.com",
    "casalemedia.com",
    "adsafeprotected.com",
    "chartbeat.com",
    "scorecardresearch.com",
    "quantserve.com",
    "krxd.net",
    "demdex.net",
    "advertising.com",
    "adtechus.com",
    "unityads.unity3d.com",
    "facebook.com/tr",
    "facebook.com/ads",
    "graph.facebook.com/pixel",
    "ads-api.twitter.com",
    "analytics.twitter.com",
    "youtube.com/api/stats/ads",
    "youtube.com/pagead",
    "youtube.com/get_midroll",
];

function isAdBlocked(url) {
    const urlStr = url.toString();
    return ADBLOCK_PATTERNS.some(p => urlStr.includes(p));
}

const swPath = self.location.pathname;
const basePath = swPath.substring(0, swPath.lastIndexOf('/') + 1);
self.basePath = basePath;

self.$scramjet = {
    files: {
        wasm: new URL("vendor/scramjet.wasm.wasm", self.location.href).href,
        sync: new URL("vendor/scramjet.sync.js", self.location.href).href,
    }
};

// Runtime ships with this repo (vendor/), so no CDN is required.
importScripts("vendor/scramjet.all.js");
importScripts("vendor/bare-mux.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker({
    prefix: basePath + "scramjet/"
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

let wispConfig = { wispurl: null, servers: [], autoswitch: true };

async function pingServer(url) {
    return new Promise(resolve => {
        const start = Date.now();
        try {
            const ws = new WebSocket(url);
            const t = setTimeout(() => { try { ws.close(); } catch {} resolve({ url, success: false, latency: null }); }, 3000);
            ws.onopen = () => { clearTimeout(t); try { ws.close(); } catch {} resolve({ url, success: true, latency: Date.now() - start }); };
            ws.onerror = () => { clearTimeout(t); resolve({ url, success: false, latency: null }); };
        } catch { resolve({ url, success: false, latency: null }); }
    });
}

function notifyClients(msg) {
    self.clients.matchAll().then(clients => clients.forEach(c => c.postMessage(msg)));
}

async function proactiveCheck() {
    if (!wispConfig.autoswitch || !wispConfig.servers?.length) return;
    const results = await Promise.all(wispConfig.servers.map(s => pingServer(s.url)));
    const currentOk = results.find(r => r.url === wispConfig.wispurl)?.success;
    if (!currentOk) {
        const best = results.filter(r => r.success).sort((a,b) => a.latency - b.latency)[0];
        if (best) {
            wispConfig.wispurl = best.url;
            notifyClients({ type: 'wispChanged', url: best.url, name: wispConfig.servers.find(s => s.url === best.url)?.name || 'Server', latency: best.latency });
        }
    }
}

self.addEventListener("message", ({ data }) => {
    if (data.type === "config") {
        if (data.wispurl) wispConfig.wispurl = data.wispurl;
        if (data.servers?.length) { wispConfig.servers = data.servers; if (wispConfig.autoswitch) setTimeout(proactiveCheck, 500); }
        if (typeof data.autoswitch !== 'undefined') wispConfig.autoswitch = data.autoswitch;
    } else if (data.type === "ping") {
        pingServer(wispConfig.wispurl).then(result => notifyClients({ type: 'pingResult', ...result }));
    }
});

// THE CORRECT PATTERN: scramjet.fetch(event) handles everything internally.
// BareMux transport is set on the client side — the SW does not manage connections.
//
// Only URLs under the proxy prefix belong to the engine. Everything else — the
// site's own pages, covers and game documents — is left to the browser's native
// network path instead of being routed through a JS handler first, and the
// config is loaded once instead of on every intercepted request.
let configPromise = null;
function ensureConfig() {
    if (!configPromise) {
        configPromise = scramjet.loadConfig().catch(err => { configPromise = null; throw err; });
    }
    return configPromise;
}

const proxyPrefix = new URL(basePath + "scramjet/", self.location.href).href;

self.addEventListener("fetch", event => {
    if (isAdBlocked(event.request.url)) {
        event.respondWith(new Response(null, { status: 204 }));
        return;
    }
    if (!event.request.url.startsWith(proxyPrefix)) return;
    event.respondWith((async () => {
        await ensureConfig();
        if (scramjet.route(event)) return scramjet.fetch(event);
        return fetch(event.request);
    })());
});