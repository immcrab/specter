#!/usr/bin/env node
/**
 * Build `specter.html` — the whole launcher inlined into a single HTML file
 * that anyone can download and open straight from their computer.
 *
 * Usage:
 *   node scripts/build-single-file.mjs
 *
 * What gets inlined:
 *   - assets/layout-v2.css, assets/desktop-os.css, Font Awesome (+ its webfonts)
 *   - assets/adblock-guard.js, assets/ad-clicks.js
 *   - data/zones.json, data/popularity.json, data/ads.json and the ad HTML files
 *   - assets/legal/*.md, src/ai.html, version.json
 *   - the favicon and the build-guide screenshots
 *
 * Every relative fetch() in the page is answered from the embedded copies by a
 * tiny runtime shim, so the file works from file:// with no server. The proxy
 * browser is the one exception: it needs sw.js + bareworker.js, which a single
 * document cannot register, so that screen explains the limitation instead.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const readBuffer = (path) => readFileSync(join(root, path));

const HOSTED_SITE = 'https://math.scribbleai.dev/';

const version = JSON.parse(read('version.json'));

let html = read('index.html');

/** Inline a stylesheet tag, keeping `$` sequences in the CSS literal. */
function inlineStylesheet(pattern, css) {
    let found = false;
    html = html.replace(pattern, () => {
        found = true;
        return `<style>\n${css}\n</style>`;
    });
    if (!found) throw new Error(`Stylesheet not found: ${pattern}`);
}

inlineStylesheet(
    /<link rel="stylesheet" href="assets\/layout-v2\.css[^"]*">/,
    read('assets/layout-v2.css')
);
inlineStylesheet(
    /<link rel="stylesheet" href="assets\/desktop-os\.css[^"]*">/,
    read('assets/desktop-os.css')
);

// Font Awesome: drop the truetype fallbacks and embed the woff2 files instead.
const fontAwesome = read('vendor/fontawesome/all.min.css')
    .replace(/,url\(\.\.\/webfonts\/[^)]+\.ttf\) format\("truetype"\)/g, '')
    .replace(/url\(\.\.\/webfonts\/([^)]+?)\)/g, (_match, file) => {
        const font = readBuffer(`vendor/fontawesome/webfonts/${file}`).toString('base64');
        return `url(data:font/woff2;base64,${font})`;
    });
html = html.replace(
    /<link rel="stylesheet" href="vendor\/fontawesome\/all\.min\.css" media="print" onload="this\.media='all'">/,
    () => `<style>\n${fontAwesome}\n</style>`
);
html = html.replace(
    /\s*<noscript><link rel="stylesheet" href="vendor\/fontawesome\/all\.min\.css"><\/noscript>/,
    ''
);

// Local scripts become inline scripts. Neither file contains a closing script tag.
for (const script of ['assets/adblock-guard.js', 'assets/ad-clicks.js']) {
    const pattern = new RegExp(`<script src="${script.replace(/[.]/g, '\\.')}" defer><\\/script>`);
    let found = false;
    html = html.replace(pattern, () => {
        found = true;
        return `<script>\n${read(script)}\n</script>`;
    });
    if (!found) throw new Error(`Script not found: ${script}`);
}

// Favicon and the screenshots in the "Make your own Aether" guide.
html = html.replace(
    /<link rel="icon" type="image\/png" href="assets\/favicon\.png">/,
    () => {
        const icon = readBuffer('assets/favicon.png').toString('base64');
        return `<link rel="icon" type="image/png" href="data:image/png;base64,${icon}">`;
    }
);
html = html.replace(/src="assets\/guide\/([^"]+)"/g, (_match, file) => {
    const image = readBuffer(`assets/guide/${file}`).toString('base64');
    return `src="data:image/png;base64,${image}"`;
});

// Photography used by the tutoring screens, inlined so the download is standalone.
html = html.replace(/src="assets\/tutoring\/([^"]+)"/g, (_match, file) => {
    const image = readBuffer(`assets/tutoring/${file}`).toString('base64');
    return `src="data:image/jpeg;base64,${image}"`;
});

/** Relative files the page fetches at runtime, embedded as text. */
const embeddedFiles = {
    'data/zones.json': { type: 'application/json', path: 'data/zones.json' },
    'data/popularity.json': { type: 'application/json', path: 'data/popularity.json' },
    'data/ads.json': { type: 'application/json', path: 'data/ads.json' },
    'data/ad-side-left.html': { type: 'text/html; charset=utf-8', path: 'data/ad-side-left.html' },
    'data/ad-side-right.html': { type: 'text/html; charset=utf-8', path: 'data/ad-side-right.html' },
    'data/ads-native.html': { type: 'text/html; charset=utf-8', path: 'data/ads-native.html' },
    'assets/legal/tos.md': { type: 'text/markdown; charset=utf-8', path: 'assets/legal/tos.md' },
    'assets/legal/privacy.md': { type: 'text/markdown; charset=utf-8', path: 'assets/legal/privacy.md' },
    'assets/legal/dmca.md': { type: 'text/markdown; charset=utf-8', path: 'assets/legal/dmca.md' },
    'src/ai.html': { type: 'text/html; charset=utf-8', path: 'src/ai.html' },
    'version.json': { type: 'application/json', path: 'version.json' },
    'worker.js': { type: 'text/javascript; charset=utf-8', path: 'worker.js' },
};

const bundle = { version: version.version, hosted: HOSTED_SITE, files: {} };
for (const [key, file] of Object.entries(embeddedFiles)) {
    bundle.files[key] = { type: file.type, body: read(file.path) };
}

// `JSON.stringify` escapes quotes and backslashes; the extra pass makes sure an
// embedded `</script>` can never close the data tag early.
const payload = JSON.stringify(bundle).replace(/<\/(script)/gi, '<\\/$1');

const runtime = String.raw`(function () {
    'use strict';
    var dataEl = document.getElementById('specter-single-file-data');
    if (!dataEl) return;

    var bundle = JSON.parse(dataEl.textContent);
    var keys = Object.keys(bundle.files);
    window.__SPECTER_SINGLE_FILE__ = { version: bundle.version, files: keys.slice() };

    // Resolve a fetch target to one of the embedded files. Works from file://,
    // where the page can sit anywhere on disk, by matching on the path tail.
    function embeddedKey(href) {
        var path = String(href);
        try { path = new URL(path, document.baseURI).pathname; } catch (e) { /* keep the raw string */ }
        try { path = decodeURIComponent(path); } catch (e) { /* already decoded */ }
        path = path.replace(/^\/+/, '');
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (path === key || path.slice(-(key.length + 1)) === '/' + key) return key;
        }
        return null;
    }

    var nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
    window.fetch = function (input, init) {
        var href = typeof input === 'string' ? input : (input && input.url) || '';
        var key = embeddedKey(href);
        if (key !== null) {
            return Promise.resolve(new Response(bundle.files[key].body, {
                status: 200,
                statusText: 'OK',
                headers: { 'Content-Type': bundle.files[key].type }
            }));
        }
        if (nativeFetch) return nativeFetch(input, init);
        return Promise.reject(new Error('Network access is unavailable in this build.'));
    };

    var NOTICES = {
        proxy: {
            title: 'The proxy browser needs the full site',
            body: 'The private browser runs on a service worker (sw.js) and a bare worker (bareworker.js). A downloaded HTML file cannot register those helpers, so this screen is switched off here. Games, AI, tools, settings and the rest of the launcher all work from this file.'
        },
        lucide: {
            title: 'Lucide ships with the hosted site',
            body: 'Lucide is a separate bundled app inside the repository. Open the hosted site, or a self-hosted copy of the full folder, to use it.'
        }
    };

    function showNotice(kind) {
        var notice = NOTICES[kind] || NOTICES.proxy;
        var existing = document.getElementById('specter-single-file-notice');
        if (existing) existing.remove();

        var overlay = document.createElement('div');
        overlay.id = 'specter-single-file-notice';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,0.82);backdrop-filter:blur(10px);';
        overlay.innerHTML =
            '<div style="max-width:460px;width:100%;background:var(--card-bg,rgba(24,24,24,0.72));border:1px solid var(--accent,#e5e5e5);border-radius:16px;padding:28px;box-shadow:0 0 50px var(--accent-glow,rgba(255,255,255,0.2));font-family:var(--font,Arial,sans-serif);color:var(--text-primary,#f5f5f5);">' +
                '<div style="font-size:0.62rem;letter-spacing:3px;text-transform:uppercase;color:var(--accent,#e5e5e5);margin-bottom:12px;">Single-file build</div>' +
                '<h2 style="margin:0 0 12px;font-size:1.15rem;line-height:1.35;">' + notice.title + '</h2>' +
                '<p style="margin:0 0 18px;font-size:0.85rem;line-height:1.7;color:var(--text-dim,#9a9a9a);">' + notice.body + '</p>' +
                '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
                    '<a href="' + bundle.hosted + '" target="_blank" rel="noopener" style="background:var(--accent,#e5e5e5);color:#000;text-decoration:none;font-weight:bold;font-size:0.78rem;padding:10px 18px;border-radius:8px;">Open hosted site</a>' +
                    '<button type="button" data-close style="background:transparent;border:1px solid var(--border,rgba(255,255,255,0.14));color:var(--text-primary,#f5f5f5);font-family:inherit;font-size:0.78rem;padding:10px 18px;border-radius:8px;cursor:pointer;">Close</button>' +
                '</div>' +
            '</div>';

        overlay.addEventListener('click', function (event) {
            if (event.target === overlay || event.target.hasAttribute('data-close')) overlay.remove();
        });
        document.body.appendChild(overlay);
    }

    // The proxy and Lucide both need files that only exist in the folder build.
    function wrapNavigation() {
        var originalNav = window.nav;
        if (typeof originalNav !== 'function' || originalNav.__specterSingleFile) return;
        var wrapped = function (page) {
            if (page === 'proxy' || page === 'lucide') {
                showNotice(page);
                return Promise.resolve();
            }
            return originalNav.apply(this, arguments);
        };
        wrapped.__specterSingleFile = true;
        window.nav = wrapped;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wrapNavigation, { once: true });
    } else {
        wrapNavigation();
    }
})();`;

const injection = [
    `<script id="specter-single-file-data" type="application/json">${payload}</script>`,
    `<script>${runtime}</script>`,
].join('\n    ');

html = html.replace(/(<meta charset="UTF-8">)/, (_match, meta) => `${meta}\n    ${injection}`);

const banner = `<!-- Specter single-file build v${version.version} - generated by scripts/build-single-file.mjs, do not edit by hand -->`;
html = html.replace(/^<!DOCTYPE html>/i, `<!DOCTYPE html>\n${banner}`);

writeFileSync(join(root, 'specter.html'), html);
const megabytes = (Buffer.byteLength(html) / (1024 * 1024)).toFixed(2);
console.log(`Built specter.html (v${version.version}, ${megabytes} MB).`);
