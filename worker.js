/**
 * Aether Gate Proxy — a single-file Cloudflare Worker
 * ===================================================
 *
 * What it does
 * ------------
 * - Serves a small browser shell at `/` (address bar, back / forward / reload,
 *   shortcuts) with the proxied page in a frame.
 * - Proxies any http(s) page at `/p/<scheme>/<host>/<path>` and rewrites HTML,
 *   CSS, redirects and cookies so the site works from your own origin.
 * - Puts a short sponsor break in front of page loads: a 2-second minimum ad
 *   gate (or however long the ad takes to load, capped at 8s) that is enforced
 *   on the server. Once passed, a signed pass cookie lets the visitor browse
 *   for 30 minutes, so clicking a link, opening a video or scrolling TikTok
 *   does not show the ad again. Sub-resources (scripts, images, XHR, media)
 *   are never gated.
 *
 * Deploy
 * ------
 *   npx wrangler deploy
 *   npx wrangler secret put AD_SECRET   # any long random string
 *
 * Optional
 * --------
 *   npx wrangler secret put AD_HTML     # ad-network markup for the gate slot
 *   (or set AD_HTML as a plain [vars] value in wrangler.toml)
 *
 * Known limits of a rewriting proxy (all simple proxies share these):
 * - Cookies from every proxied site share one origin.
 * - A page that hard-codes absolute `/chunk.js`-style script imports, opens its
 *   own WebSocket, or is behind a bot challenge may not fully load.
 * - Service workers are disabled inside proxied pages on purpose, because they
 *   would take over this origin.
 */

const PROXY_PREFIX = "/p/";
const PASS_ROUTE = "/__pass";
const AD_ROUTE = "/__ad";
const PASS_COOKIE = "__aether_pass";
// The site's Proxy tab frames this worker on another origin, which makes every
// request here third-party. A Lax cookie is never sent in that context, so the
// gate would repeat on every navigation; the embedded case uses a partitioned
// cookie instead, and either one satisfies the gate.
const PASS_COOKIE_EMBED = "__aether_pass_embed";
const GATE_COOKIES = [PASS_COOKIE, PASS_COOKIE_EMBED];

const MIN_AD_MS = 2000; // the ad must be on screen at least this long
const AD_CAP_MS = 8000; // stop waiting for a slow ad after this long
const PASS_TTL_MS = 30 * 60 * 1000; // how long one break buys
const TICKET_TTL_MS = 5 * 60 * 1000; // how long a gate ticket stays usable

const DEFAULT_SECRET = "aether-gate-proxy-change-me";

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function htmlResponse(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
      ...extraHeaders,
    },
  });
}

function textResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * Turn an absolute URL into its proxy address. Path shape keeps `/` characters
 * readable and, crucially, keeps relative URL resolution working in the browser:
 *   https://example.com/a/b?q=1  ->  /p/https/example.com/a/b?q=1
 */
function proxyPathFor(href) {
  const url = new URL(href);
  return (
    PROXY_PREFIX +
    url.protocol.slice(0, -1) +
    "/" +
    url.host +
    url.pathname +
    url.search +
    url.hash
  );
}

/** Read the target site out of a proxy request URL. */
function targetFromUrl(url) {
  if (!url.pathname.startsWith(PROXY_PREFIX)) return null;
  const rest = url.pathname.slice(PROXY_PREFIX.length);
  const schemeEnd = rest.indexOf("/");
  const scheme = (schemeEnd === -1 ? rest : rest.slice(0, schemeEnd)).toLowerCase();
  if (scheme !== "http" && scheme !== "https") return null;
  const afterScheme = schemeEnd === -1 ? "" : rest.slice(schemeEnd + 1);
  const hostEnd = afterScheme.indexOf("/");
  const host = hostEnd === -1 ? afterScheme : afterScheme.slice(0, hostEnd);
  if (!host) return null;
  const path = hostEnd === -1 ? "/" : afterScheme.slice(hostEnd);
  let target;
  try {
    target = new URL(scheme + "://" + host + path + url.search);
  } catch {
    return null;
  }
  if (!target.hostname) return null;
  return target;
}

const SKIP_SCHEMES = /^(data|blob|javascript|mailto|tel|about|file|magnet|intent|chrome|edge):/i;

/** Rewrite one URL found in HTML/CSS into its proxy address, or null to keep it. */
function toProxyHref(raw, baseHref, proxyOrigin) {
  if (raw == null) return null;
  const value = String(raw).trim();
  if (!value || value.startsWith("#") || SKIP_SCHEMES.test(value)) return null;
  let absolute;
  try {
    absolute = new URL(value, baseHref);
  } catch {
    return null;
  }
  if (absolute.protocol !== "http:" && absolute.protocol !== "https:") return null;
  // Already a proxy address (e.g. written by the runtime shim).
  if (proxyOrigin && absolute.origin === proxyOrigin) return null;
  return proxyPathFor(absolute.href);
}

/** Rewrite `url()` references and @import targets in a CSS string. */
function rewriteCssText(css, baseHref, proxyOrigin) {
  if (!css || typeof css !== "string") return css;
  let output = css.replace(/url\(\s*(['"]?)([^'")]+?)\1\s*\)/gi, (match, quote, raw) => {
    const rewritten = toProxyHref(raw, baseHref, proxyOrigin);
    return rewritten ? "url(" + quote + rewritten + quote + ")" : match;
  });
  output = output.replace(
    /@import\s+(['"])([^'"]+)\1/gi,
    (match, quote, raw) => {
      const rewritten = toProxyHref(raw, baseHref, proxyOrigin);
      return rewritten ? "@import " + quote + rewritten + quote : match;
    }
  );
  return output;
}

/** Rewrite a comma-separated srcset value. */
function rewriteSrcset(value, baseHref, proxyOrigin) {
  if (!value || value.includes("data:")) return value;
  return value
    .split(",")
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed) return trimmed;
      const separator = trimmed.search(/\s/);
      const raw = separator === -1 ? trimmed : trimmed.slice(0, separator);
      const tail = separator === -1 ? "" : trimmed.slice(separator);
      const rewritten = toProxyHref(raw, baseHref, proxyOrigin);
      return rewritten ? rewritten + tail : trimmed;
    })
    .join(", ");
}

function readCookie(request, name) {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const equals = trimmed.indexOf("=");
    if (equals === -1) continue;
    if (trimmed.slice(0, equals) === name) return trimmed.slice(equals + 1);
  }
  return null;
}

function stripGateCookie(header) {
  if (!header) return "";
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !GATE_COOKIES.some((name) => part.toLowerCase().startsWith(name + "=")))
    .join("; ");
}

/* -------------------------------------------------------------------------- */
/* Gate tickets and the pass cookie (HMAC signed, server enforced)            */
/* -------------------------------------------------------------------------- */

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function gateSecret(env) {
  return (env && env.AD_SECRET) || DEFAULT_SECRET;
}

async function makeTicket(env, targetPath) {
  const issuedAt = Date.now();
  const signature = await hmacHex(gateSecret(env), "gate:" + issuedAt + ":" + targetPath);
  return issuedAt + "." + signature;
}

async function passTokenValid(raw, env) {
  if (!raw) return false;
  const [issuedRaw, signature] = raw.split(".");
  const issuedAt = Number(issuedRaw);
  if (!Number.isFinite(issuedAt) || !signature) return false;
  const age = Date.now() - issuedAt;
  if (age < 0 || age > PASS_TTL_MS) return false;
  const expected = await hmacHex(gateSecret(env), "pass:" + issuedAt);
  return expected === signature;
}

async function passesCookie(request, env) {
  for (const name of GATE_COOKIES) {
    if (await passTokenValid(readCookie(request, name), env)) return true;
  }
  return false;
}

function passCookieHeaders(issuedAt, signature) {
  const value = issuedAt + "." + signature;
  const tail =
    "; Path=/; Max-Age=" + Math.round(PASS_TTL_MS / 1000) + "; HttpOnly; Secure";
  return [
    // Shell opened on its own address: a plain first-party cookie.
    PASS_COOKIE + "=" + value + "; SameSite=Lax" + tail,
    // Shell framed by the site: partitioned, because a Lax cookie is never sent
    // inside a cross-site frame and the gate would then repeat on every page.
    PASS_COOKIE_EMBED + "=" + value + "; SameSite=None; Partitioned" + tail,
  ];
}

/** Only real page navigations get the gate. Assets, XHR and media never do. */
function isPageNavigation(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const mode = (request.headers.get("sec-fetch-mode") || "").toLowerCase();
  const destination = (request.headers.get("sec-fetch-dest") || "").toLowerCase();
  if (mode === "navigate") {
    return (
      destination === "" ||
      destination === "document" ||
      destination === "iframe" ||
      destination === "frame"
    );
  }
  if (mode) return false;
  // Very old browsers and curl: assume an HTML document request.
  return (request.headers.get("accept") || "").toLowerCase().includes("text/html");
}

/* -------------------------------------------------------------------------- */
/* Sponsor break page                                                         */
/* -------------------------------------------------------------------------- */

// The sponsor slot lives on the site so the ad network sees the site's own
// referrer. Point AD_HTML at a different unit (or network) to override it.
const GATE_AD_URL = "https://math.scribbleai.dev/ad-gate.html";

function adDocument(env) {
  const custom = env && typeof env.AD_HTML === "string" ? env.AD_HTML.trim() : "";
  const slot = custom
    ? custom
    : `<iframe src="${GATE_AD_URL}" title="Advertisement" scrolling="no"></iframe>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html,body{margin:0;height:100%;background:transparent}
  body{display:grid;place-items:center;overflow:hidden}
  iframe{width:300px;height:250px;max-width:100%;border:0}
</style>
</head><body>${slot}
<script>function ready(){try{parent.postMessage("aether-ad-ready","*")}catch(e){}}
addEventListener("load",function(){setTimeout(ready,250)});setTimeout(ready,3000);</script>
</body></html>`;
}

function gatePage(targetPath, target, ticket) {
  const passUrl = PASS_ROUTE + "?to=" + encodeURIComponent(targetPath) + "&ticket=" + encodeURIComponent(ticket);
  const host = target.host || "the site";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#09090b">
<title>Sponsor break</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%2309090b'/%3E%3Cpath d='M16 5l3 8 8 3-8 3-3 8-3-8-8-3 8-3z' fill='%23f4f4f5'/%3E%3C/svg%3E">
<style>
  :root{color-scheme:dark;--bg:#09090b;--panel:#111114;--line:rgba(255,255,255,.1);--text:#f4f4f5;--muted:#8d8d96}
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;background:
      radial-gradient(900px 500px at 50% -10%,rgba(255,255,255,.07),transparent 70%),
      var(--bg);
    color:var(--text);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    display:flex;align-items:center;justify-content:center;padding:18px}
  .wrap{width:100%;max-width:390px}
  .brand{display:flex;align-items:center;gap:9px;font-size:12px;letter-spacing:.2em;font-weight:700;margin:0 0 14px 4px}
  .brand .mark{font-size:15px;letter-spacing:0}
  .brand .tag{margin-left:auto;font-size:9px;letter-spacing:.18em;font-weight:600;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:4px 9px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:14px;box-shadow:0 24px 60px -30px rgba(0,0,0,.9)}
  .ad-label{font-size:9px;letter-spacing:.2em;font-weight:700;color:var(--muted);text-transform:uppercase;padding:2px 4px 9px}
  .ad-box{width:100%;height:250px;border-radius:12px;overflow:hidden;background:#e9e9ef;border:1px solid rgba(255,255,255,.08)}
  .ad-box iframe{width:100%;height:100%;border:0;display:block}
  .progress{height:3px;border-radius:999px;background:rgba(255,255,255,.08);margin:14px 4px 10px;overflow:hidden}
  .progress span{display:block;height:100%;width:0;background:var(--text);border-radius:999px;transition:width .12s linear}
  .wait{margin:0 4px 12px;font-size:12px;color:var(--muted);min-height:17px}
  button{width:100%;border:0;border-radius:12px;padding:13px 16px;font:inherit;font-weight:650;font-size:13px;
    background:rgba(255,255,255,.08);color:var(--muted);cursor:not-allowed;transition:background .15s,color .15s,transform .15s}
  button.ready{background:var(--text);color:#09090b;cursor:pointer}
  button.ready:active{transform:scale(.99)}
  .note{margin:12px 4px 2px;font-size:10.5px;line-height:1.5;color:#6f6f78;text-align:center}
  @media (max-height:520px){.ad-box{height:190px}}
</style>
</head>
<body>
<main class="wrap">
  <div class="brand"><span class="mark">◈</span> AETHER <span class="tag">SPONSOR BREAK</span></div>
  <section class="card">
    <div class="ad-label">Advertisement</div>
    <div class="ad-box"><iframe id="ad" src="${AD_ROUTE}" title="Advertisement" scrolling="no"></iframe></div>
    <div class="progress"><span id="bar"></span></div>
    <p class="wait" id="wait">Loading ad…</p>
    <button id="go" disabled>Continue to ${htmlEscape(host)}</button>
    <p class="note">A short break keeps the proxy free. After this you browse without ads for 30 minutes.</p>
  </section>
</main>
<script>
(function () {
  var MIN = ${MIN_AD_MS};
  var CAP = ${AD_CAP_MS};
  var PASS_URL = ${jsonForScript(passUrl)};

  var frame = document.getElementById('ad');
  var button = document.getElementById('go');
  var bar = document.getElementById('bar');
  var wait = document.getElementById('wait');

  var startedAt = performance.now();
  var adReady = false;
  var finished = false;
  var timer = null;

  function markReady() { adReady = true; }
  frame.addEventListener('load', markReady);
  window.addEventListener('message', function (event) {
    if (event.data === 'aether-ad-ready') markReady();
  });
  setTimeout(markReady, CAP);

  function finish() {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    bar.style.width = '100%';
    wait.textContent = 'Your break is over. Loading the page…';
    button.disabled = false;
    button.classList.add('ready');
    setTimeout(function () { location.replace(PASS_URL); }, 350);
  }

  function tick() {
    var elapsed = performance.now() - startedAt;
    bar.style.width = Math.min(100, (elapsed / MIN) * 100).toFixed(1) + '%';
    if (elapsed >= MIN && adReady) { finish(); return; }
    if (elapsed < MIN) {
      var left = Math.ceil((MIN - elapsed) / 1000);
      wait.textContent = adReady ? 'Continue in ' + left + 's…' : 'Loading ad…';
    } else {
      wait.textContent = 'Waiting for the ad to finish loading…';
    }
  }

  button.addEventListener('click', function () { location.replace(PASS_URL); });
  timer = setInterval(tick, 80);
  tick();
})();
</script>
</body>
</html>`;
}

/* -------------------------------------------------------------------------- */
/* HTML rewriting                                                             */
/* -------------------------------------------------------------------------- */

const URL_ATTRIBUTES = [
  ["a[href]", "href"],
  ["area[href]", "href"],
  ["link[href]", "href"],
  ["script[src]", "src"],
  ["img[src]", "src"],
  ["video[src]", "src"],
  ["video[poster]", "poster"],
  ["audio[src]", "src"],
  ["source[src]", "src"],
  ["track[src]", "src"],
  ["iframe[src]", "src"],
  ["frame[src]", "src"],
  ["embed[src]", "src"],
  ["object[data]", "data"],
  ["form[action]", "action"],
  ["input[formaction]", "formaction"],
  ["button[formaction]", "formaction"],
  ["blockquote[cite]", "cite"],
  ["q[cite]", "cite"],
  ["del[cite]", "cite"],
  ["ins[cite]", "cite"],
];

/** Browser-side shim: absolute same-site URLs in JS keep flowing through us. */
function runtimeScript(docHref) {
  return `<script data-aether-runtime>(function () {
  'use strict';
  var UPSTREAM = ${jsonForScript(docHref)};
  var PROXY_ORIGIN = location.origin;
  var PREFIX = PROXY_ORIGIN + ${jsonForScript(PROXY_PREFIX)};

  function toProxy(value) {
    if (value === null || value === undefined) return value;
    var raw = String(value);
    if (!raw || raw.charAt(0) === '#' || /^(data|blob|javascript|mailto|tel|about|file|magnet|intent):/i.test(raw)) return value;
    var resolved;
    try { resolved = new URL(raw, UPSTREAM); } catch (error) { return value; }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return value;
    if (resolved.origin === PROXY_ORIGIN) return value;
    return PREFIX + resolved.protocol.slice(0, -1) + '/' + resolved.host + resolved.pathname + resolved.search + resolved.hash;
  }

  if (window.fetch) {
    var nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      try {
        if (typeof input === 'string' || input instanceof URL) return nativeFetch.call(this, toProxy(input), init);
        if (typeof Request !== 'undefined' && input instanceof Request) return nativeFetch.call(this, new Request(toProxy(input.url), input), init);
      } catch (error) {}
      return nativeFetch.apply(this, arguments);
    };
  }

  var nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function () {
    var args = Array.prototype.slice.call(arguments);
    try { args[1] = toProxy(args[1]); } catch (error) {}
    return nativeOpen.apply(this, args);
  };

  if (navigator.sendBeacon) {
    var nativeBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      try { return nativeBeacon(toProxy(url), data); } catch (error) { return nativeBeacon(url, data); }
    };
  }

  if (navigator.serviceWorker) {
    try {
      navigator.serviceWorker.register = function () {
        return Promise.reject(new Error('Service workers are disabled inside the Aether proxy.'));
      };
    } catch (error) {}
  }

  window.__aetherProxy = { upstream: UPSTREAM, toProxy: toProxy };
})();</script>`;
}

function buildHtmlRewriter(target, proxyOrigin) {
  const docHref = target.href;
  const rewriter = new HTMLRewriter();

  rewriter.on("head", {
    element(element) {
      element.prepend(
        `<base href="${htmlEscape(proxyPathFor(docHref))}">` + runtimeScript(docHref),
        { html: true }
      );
    },
  });

  // Our own base must be the only one in the document.
  rewriter.on("base[href]", { element(element) { element.remove(); } });

  for (const [selector, attribute] of URL_ATTRIBUTES) {
    rewriter.on(selector, {
      element(element) {
        const rewritten = toProxyHref(element.getAttribute(attribute), docHref, proxyOrigin);
        if (rewritten) element.setAttribute(attribute, rewritten);
      },
    });
  }

  // SVG references keep their xlink:href form; the selector parser does not
  // accept the namespaced colon, so read both attributes directly.
  rewriter.on("use, image", {
    element(element) {
      for (const attribute of ["href", "xlink:href"]) {
        const rewritten = toProxyHref(element.getAttribute(attribute), docHref, proxyOrigin);
        if (rewritten) element.setAttribute(attribute, rewritten);
      }
    },
  });

  rewriter.on("img[srcset], source[srcset]", {
    element(element) {
      const rewritten = rewriteSrcset(element.getAttribute("srcset"), docHref, proxyOrigin);
      if (rewritten) element.setAttribute("srcset", rewritten);
    },
  });

  rewriter.on("[style]", {
    element(element) {
      const style = element.getAttribute("style");
      const rewritten = rewriteCssText(style, docHref, proxyOrigin);
      if (rewritten && rewritten !== style) element.setAttribute("style", rewritten);
    },
  });

  rewriter.on("meta", {
    element(element) {
      const httpEquiv = (element.getAttribute("http-equiv") || "").toLowerCase();
      if (httpEquiv === "content-security-policy" || httpEquiv === "content-security-policy-report-only") {
        element.remove();
        return;
      }
      if (httpEquiv === "refresh") {
        const content = element.getAttribute("content") || "";
        const match = content.match(/(url\s*=\s*)(['"]?)([^'";]+)\2/i);
        if (!match) return;
        const rewritten = toProxyHref(match[3].trim(), docHref, proxyOrigin);
        if (rewritten) element.setAttribute("content", content.replace(match[0], match[1] + match[2] + rewritten + match[2]));
      }
    },
  });

  // Sub-resource integrity hashes break once a resource is fetched via us.
  rewriter.on("[integrity]", {
    element(element) { element.removeAttribute("integrity"); },
  });

  return rewriter;
}

/* -------------------------------------------------------------------------- */
/* Header handling                                                            */
/* -------------------------------------------------------------------------- */

const DROP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "accept-encoding",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "cf-worker",
  "cdn-loop",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-real-ip",
]);

const DROP_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "x-content-security-policy",
  "strict-transport-security",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "permissions-policy",
  "feature-policy",
  "expect-ct",
  "report-to",
  "nel",
  "alt-svc",
  "public-key-pins",
  "x-permitted-cross-domain-policies",
]);

function rewriteSetCookie(value) {
  const parts = String(value).split(";");
  const kept = [parts[0]];
  for (let index = 1; index < parts.length; index += 1) {
    const attribute = parts[index].trim();
    if (!attribute) continue;
    const equals = attribute.indexOf("=");
    const name = (equals === -1 ? attribute : attribute.slice(0, equals)).trim().toLowerCase();
    if (name === "domain" || name === "path" || name === "partitioned") continue;
    kept.push(attribute);
  }
  let cookie = kept.join("; ");
  if (!/;\s*path=/i.test(cookie)) cookie += "; Path=/";
  if (!/;\s*secure/i.test(cookie)) cookie += "; Secure";
  return cookie;
}

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") {
    const list = headers.getSetCookie();
    if (list.length) return list;
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function rewriteRefreshHeader(value, target) {
  const match = String(value).match(/(url\s*=\s*)(['"]?)(\S+?)\2\s*$/i);
  if (!match) return value;
  const rewritten = toProxyHref(match[3], target.href, null);
  return rewritten ? match[1] + match[2] + rewritten + match[2] : value;
}

function sanitizeResponseHeaders(responseHeaders, target) {
  const headers = new Headers();
  const setCookies = getSetCookies(responseHeaders);

  for (const [name, value] of responseHeaders) {
    const key = name.toLowerCase();
    if (key === "set-cookie") continue;
    if (DROP_RESPONSE_HEADERS.has(key)) continue;
    if (key === "location" || key === "content-location") {
      let rewritten = null;
      try {
        rewritten = toProxyHref(String(value), target.href, null);
      } catch {
        rewritten = null;
      }
      if (rewritten) headers.set(name, rewritten);
      continue;
    }
    if (key === "refresh") {
      headers.set(name, rewriteRefreshHeader(value, target));
      continue;
    }
    headers.append(name, value);
  }

  for (const cookie of setCookies) headers.append("set-cookie", rewriteSetCookie(cookie));
  return headers;
}

/* -------------------------------------------------------------------------- */
/* Proxying                                                                   */
/* -------------------------------------------------------------------------- */

function isHtmlType(contentType) {
  return /text\/html|application\/xhtml\+xml/i.test(contentType || "");
}

async function handleProxy(request, url, env) {
  const target = targetFromUrl(url);
  if (!target) {
    return htmlResponse(
      `<!doctype html><meta charset="utf-8"><title>Not a proxy address</title>
       <body style="font:14px/1.6 system-ui,sans-serif;background:#09090b;color:#f4f4f5;display:grid;place-items:center;height:100vh;margin:0;text-align:center">
       <div><h1 style="font-size:18px">That address is not proxied.</h1>
       <p style="color:#8d8d96">Start from <a style="color:#fff" href="/">the Aether shell</a>.</p></div>`,
      400
    );
  }

  if (request.headers.get("upgrade")) {
    return textResponse("WebSocket connections are not proxied by this worker.", 501);
  }

  if (isPageNavigation(request) && !(await passesCookie(request, env))) {
    const targetPath = url.pathname + url.search;
    const ticket = await makeTicket(env, targetPath);
    const page = gatePage(targetPath, target, ticket);
    return htmlResponse(request.method === "HEAD" ? "" : page);
  }

  const proxyOrigin = url.origin;
  const upstreamHeaders = new Headers();
  for (const [name, value] of request.headers) {
    const key = name.toLowerCase();
    if (DROP_REQUEST_HEADERS.has(key)) continue;
    if (key === "cookie") continue;
    upstreamHeaders.set(name, value);
  }

  const forwardedCookie = stripGateCookie(request.headers.get("cookie"));
  if (forwardedCookie) upstreamHeaders.set("cookie", forwardedCookie);

  if (request.headers.has("origin")) upstreamHeaders.set("origin", target.origin);
  if (request.headers.has("referer")) {
    let referer = target.origin + "/";
    try {
      const decoded = targetFromUrl(new URL(request.headers.get("referer")));
      if (decoded) referer = decoded.href;
    } catch {
      /* keep the origin fallback */
    }
    upstreamHeaders.set("referer", referer);
  }

  let upstream;
  try {
    upstream = await fetch(target.href, {
      method: request.method,
      headers: upstreamHeaders,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });
  } catch (error) {
    return htmlResponse(
      `<!doctype html><meta charset="utf-8"><title>Could not reach the site</title>
       <body style="font:14px/1.6 system-ui,sans-serif;background:#09090b;color:#f4f4f5;display:grid;place-items:center;height:100vh;margin:0;padding:24px;text-align:center">
       <div><h1 style="font-size:18px">The site did not respond.</h1>
       <p style="color:#8d8d96">${htmlEscape(target.host)} could not be reached from the proxy.</p>
       <p style="color:#5f5f68;font-size:12px">${htmlEscape(String(error && error.message ? error.message : error))}</p>
       <p><a style="color:#fff" href="/">Back to the shell</a></p></div>`,
      502
    );
  }

  const headers = sanitizeResponseHeaders(upstream.headers, target);
  const contentType = upstream.headers.get("content-type") || "";
  const noBody =
    request.method === "HEAD" ||
    upstream.status === 204 ||
    upstream.status === 304 ||
    !upstream.body;

  if (noBody) {
    return new Response(null, { status: upstream.status, statusText: upstream.statusText, headers });
  }

  if (isHtmlType(contentType)) {
    const rewriter = buildHtmlRewriter(target, proxyOrigin);
    const transformed = rewriter.transform(
      new Response(upstream.body, { status: upstream.status, headers: { "content-type": contentType } })
    );
    return new Response(transformed.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  }

  if (/text\/css/i.test(contentType)) {
    const css = await upstream.text();
    return new Response(rewriteCssText(css, target.href, proxyOrigin), {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

/* -------------------------------------------------------------------------- */
/* Browser shell                                                              */
/* -------------------------------------------------------------------------- */

const SHELL_FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%2309090b'/%3E%3Cpath d='M16 5l3 8 8 3-8 3-3 8-3-8-8-3 8-3z' fill='%23f4f4f5'/%3E%3C/svg%3E";

function shellPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#09090b">
<title>Aether · Proxy browser</title>
<link rel="icon" href="${SHELL_FAVICON}">
<style>
  :root{color-scheme:dark;--bg:#09090b;--panel:#101013;--line:rgba(255,255,255,.1);--text:#f4f4f5;--muted:#8d8d96}
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;background:var(--bg);color:var(--text);display:flex;flex-direction:column;overflow:hidden;
    font:13.5px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  header{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line);background:rgba(9,9,11,.92)}
  .brand{display:flex;align-items:center;gap:7px;font-size:11px;letter-spacing:.18em;font-weight:700;white-space:nowrap}
  .brand .mark{font-size:14px;letter-spacing:0}
  .brand small{color:var(--muted);font-size:9px;letter-spacing:.16em;font-weight:600}
  .nav{display:flex;align-items:center;gap:6px;flex:1;min-width:0}
  .icon{width:31px;height:31px;display:grid;place-items:center;border-radius:9px;border:1px solid transparent;
    background:transparent;color:var(--muted);cursor:pointer;padding:0;font-size:15px;line-height:1}
  .icon:hover{background:rgba(255,255,255,.06);color:var(--text)}
  form{display:flex;align-items:center;gap:6px;flex:1;min-width:0}
  input{flex:1;min-width:0;background:#151519;border:1px solid var(--line);border-radius:10px;color:var(--text);
    padding:8px 12px;font:inherit;font-size:12.5px;outline:none}
  input:focus{border-color:rgba(255,255,255,.28);background:#191920}
  .go{border:1px solid rgba(255,255,255,.16);background:#f4f4f5;color:#09090b;border-radius:10px;padding:8px 13px;
    font:inherit;font-size:12px;font-weight:650;cursor:pointer}
  .go:active{transform:translateY(1px)}
  .open{display:grid;place-items:center;width:31px;height:31px;border-radius:9px;color:var(--muted);text-decoration:none;font-size:14px}
  .open:hover{background:rgba(255,255,255,.06);color:var(--text)}
  .stage{position:relative;flex:1;min-height:0;background:#0d0d10}
  iframe.view{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff}
  .start{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:22px;z-index:3;
    background:radial-gradient(900px 420px at 50% -10%,rgba(255,255,255,.07),transparent 70%),var(--bg);overflow:auto}
  .start.hidden{display:none}
  .start-in{width:100%;max-width:560px}
  .start h1{margin:0 0 6px;font-size:26px;letter-spacing:-.02em;font-weight:700}
  .start p{margin:0 0 18px;color:var(--muted);font-size:13px;max-width:46ch}
  .chips{display:flex;flex-wrap:wrap;gap:8px}
  .chip{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);background:#111114;color:var(--text);
    border-radius:999px;padding:8px 13px;font:inherit;font-size:12px;cursor:pointer}
  .chip:hover{background:#17171c;border-color:rgba(255,255,255,.2)}
  .chip span{color:var(--muted);font-size:10px}
  footer{display:flex;align-items:center;gap:8px;padding:7px 12px;border-top:1px solid var(--line);
    color:#6f6f78;font-size:10.5px;background:rgba(9,9,11,.92)}
  footer b{color:#a1a1aa;font-weight:600}
  .spacer{flex:1}
  @media (max-width:680px){
    .brand small{display:none}
    header{gap:7px;padding:8px}
    .icon{width:28px;height:28px}
  }
</style>
</head>
<body>
<header>
  <div class="brand"><span class="mark">◈</span> AETHER <small>PROXY</small></div>
  <div class="nav">
    <button class="icon" id="back" title="Back" aria-label="Back">←</button>
    <button class="icon" id="forward" title="Forward" aria-label="Forward">→</button>
    <button class="icon" id="reload" title="Reload" aria-label="Reload">⟳</button>
    <form id="bar-form" autocomplete="off">
      <input id="addr" name="q" placeholder="Search or enter an address" spellcheck="false"
             autocapitalize="off" autocorrect="off" inputmode="url" aria-label="Address">
      <button class="go" type="submit">Go</button>
    </form>
    <a class="open" id="open" href="#" target="_blank" rel="noreferrer" title="Open this page in a new tab" aria-label="Open in a new tab">↗</a>
  </div>
</header>

<div class="stage">
  <iframe id="view" class="view" title="Proxied page" referrerpolicy="no-referrer"
          allow="clipboard-read; clipboard-write; fullscreen; autoplay; encrypted-media; picture-in-picture"></iframe>
  <div class="start" id="start">
    <div class="start-in">
      <h1>Where to?</h1>
      <p>Type any address, or start with one of these. The first page load shows a two second sponsor break, then you browse ad-free for 30 minutes.</p>
      <div class="chips" id="chips">
        <button class="chip" data-url="https://www.tiktok.com/">TikTok</button>
        <button class="chip" data-url="https://www.youtube.com/">YouTube</button>
        <button class="chip" data-url="https://www.reddit.com/">Reddit</button>
        <button class="chip" data-url="https://en.wikipedia.org/">Wikipedia</button>
        <button class="chip" data-url="https://duckduckgo.com/">DuckDuckGo</button>
        <button class="chip" data-url="https://www.roblox.com/">Roblox</button>
        <button class="chip" data-url="https://github.com/">GitHub</button>
      </div>
    </div>
  </div>
</div>

<footer>
  <span><b>2s</b> sponsor break per visit</span>
  <span class="spacer"></span>
  <span>Scrolling and clicking inside a site never repeats the ad</span>
</footer>

<script>
(function () {
  var frame = document.getElementById('view');
  var addr = document.getElementById('addr');
  var form = document.getElementById('bar-form');
  var openLink = document.getElementById('open');
  var start = document.getElementById('start');
  var back = document.getElementById('back');
  var forward = document.getElementById('forward');
  var reload = document.getElementById('reload');

  function decodeProxyPath(path) {
    var match = /^\\/p\\/(https?)\\/([^/]+)(\\/.*)?$/.exec(path || '');
    if (!match) return null;
    return match[1] + '://' + match[2] + (match[3] || '/');
  }

  function encodeTarget(href) {
    var url = new URL(href);
    return '/p/' + url.protocol.replace(':', '') + '/' + url.host + url.pathname + url.search + url.hash;
  }

  function remember(href) {
    try { history.replaceState(null, '', '#!' + encodeURIComponent(href)); } catch (error) {}
  }

  function go(input) {
    var value = String(input || '').trim();
    if (!value) return;
    var href;
    if (/^https?:\\/\\//i.test(value)) href = value;
    else if (/^[\\w-]+(\\.[\\w-]+)+(\\/|$)/.test(value)) href = 'https://' + value;
    else href = 'https://duckduckgo.com/?q=' + encodeURIComponent(value);
    var target;
    try { target = new URL(href); } catch (error) { return; }
    var proxied = encodeTarget(target.href);
    addr.value = target.href;
    openLink.href = proxied;
    start.classList.add('hidden');
    frame.src = proxied;
    remember(target.href);
    addr.blur();
  }

  function syncFromFrame() {
    var win;
    try { win = frame.contentWindow; } catch (error) { return; }
    if (!win) return;
    var upstream = decodeProxyPath(win.location.pathname);
    if (!upstream) return;
    upstream += win.location.search || '';
    addr.value = upstream;
    var proxied = encodeTarget(upstream);
    openLink.href = proxied;
    remember(upstream);
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    go(addr.value);
  });

  document.getElementById('chips').addEventListener('click', function (event) {
    var chip = event.target.closest('.chip');
    if (!chip) return;
    go(chip.getAttribute('data-url'));
  });

  frame.addEventListener('load', syncFromFrame);

  back.addEventListener('click', function () { try { frame.contentWindow.history.back(); } catch (error) {} });
  forward.addEventListener('click', function () { try { frame.contentWindow.history.forward(); } catch (error) {} });
  reload.addEventListener('click', function () {
    if (!frame.src || frame.src === 'about:blank') return;
    try { frame.contentWindow.location.reload(); } catch (error) { frame.src = frame.src; }
  });

  if (location.hash.indexOf('#!') === 0) {
    var initial = decodeURIComponent(location.hash.slice(2));
    if (initial) go(initial);
  }
})();
</script>
</body>
</html>`;
}

/* -------------------------------------------------------------------------- */
/* Router                                                                     */
/* -------------------------------------------------------------------------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === PASS_ROUTE) return handlePass(request, url, env);
      if (url.pathname === AD_ROUTE) {
        return new Response(adDocument(env), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "x-robots-tag": "noindex",
          },
        });
      }
      if (url.pathname === "/" || url.pathname === "/index.html") return htmlResponse(shellPage());
      if (url.pathname === "/robots.txt") {
        return new Response("User-agent: *\nDisallow: /\n", {
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
      if (url.pathname.startsWith(PROXY_PREFIX)) return handleProxy(request, url, env);

      return htmlResponse(
        `<!doctype html><meta charset="utf-8"><title>Not found</title>
         <body style="font:14px/1.6 system-ui,sans-serif;background:#09090b;color:#f4f4f5;display:grid;place-items:center;height:100vh;margin:0">
         <div style="text-align:center"><h1 style="font-size:18px">Nothing here.</h1>
         <p><a style="color:#fff" href="/">Open the Aether shell</a></p></div>`,
        404
      );
    } catch (error) {
      return htmlResponse(
        `<!doctype html><meta charset="utf-8"><title>Proxy error</title>
         <body style="font:14px/1.6 system-ui,sans-serif;background:#09090b;color:#f4f4f5;display:grid;place-items:center;height:100vh;margin:0;padding:24px">
         <div style="max-width:46ch;text-align:center"><h1 style="font-size:18px">The proxy hit an error.</h1>
         <p style="color:#8d8d96;font-size:12px">${htmlEscape(String(error && error.message ? error.message : error))}</p>
         <p><a style="color:#fff" href="/">Back to the shell</a></p></div>`,
        500
      );
    }
  },
};

async function handlePass(request, url, env) {
  const targetPath = url.searchParams.get("to") || "";
  const ticket = url.searchParams.get("ticket") || "";
  const [issuedRaw, signature] = ticket.split(".");
  const issuedAt = Number(issuedRaw);

  const invalid = (message) =>
    htmlResponse(
      `<!doctype html><meta charset="utf-8"><title>Sponsor break</title>
       <body style="font:14px/1.6 system-ui,sans-serif;background:#09090b;color:#f4f4f5;display:grid;place-items:center;height:100vh;margin:0;padding:24px;text-align:center">
       <div><h1 style="font-size:18px">${htmlEscape(message)}</h1>
       <p style="color:#8d8d96;font-size:12px">Go back to <a style="color:#fff" href="/">the shell</a> and open the page again.</p></div>`,
      403
    );

  if (!targetPath.startsWith(PROXY_PREFIX) || !targetFromUrl(new URL(targetPath, url.origin))) {
    return invalid("That page address is not valid.");
  }
  if (!Number.isFinite(issuedAt) || !signature) return invalid("This sponsor break expired.");
  if (Date.now() - issuedAt > TICKET_TTL_MS) return invalid("This sponsor break expired.");
  if (Date.now() - issuedAt < MIN_AD_MS - 50) return invalid("The sponsor break is still running.");

  const expected = await hmacHex(gateSecret(env), "gate:" + issuedAt + ":" + targetPath);
  if (expected !== signature) return invalid("This sponsor break is not valid.");

  const passIssuedAt = Date.now();
  const passSignature = await hmacHex(gateSecret(env), "pass:" + passIssuedAt);
  const headers = new Headers({
    location: targetPath,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  for (const cookie of passCookieHeaders(passIssuedAt, passSignature)) {
    headers.append("set-cookie", cookie);
  }

  return new Response(null, { status: 302, headers });
}

export { proxyPathFor, targetFromUrl, toProxyHref, rewriteCssText, rewriteSrcset };
