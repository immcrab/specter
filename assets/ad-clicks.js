/* ══════════════════════════════════════════════════════════════════════
   Aether — click popunder
   ----------------------------------------------------------------------
   Adsterra's popunder ships a full-viewport <a> that catches every click,
   which makes the whole site feel unclickable and sends the tab straight to
   the ad. This keeps the thing you actually want — sometimes a click opens
   an ad — without the side effects:

     • the injected catcher is remembered (its tracked URL is reused) and
       made click-through, so buttons, games and the guide keep working;
     • a share of genuine user clicks opens that ad in a NEW tab;
     • a cooldown stops it from firing repeatedly.

   Tuning lives in data/ads.json under "clickPopunder".
   ══════════════════════════════════════════════════════════════════════ */
(() => {
    'use strict';

    const DEFAULTS = { enabled: true, chance: 0.22, cooldownSeconds: 120 };
    const STORE_KEY = 'gl_adclick_last';

    const state = {
        enabled: DEFAULTS.enabled,
        chance: DEFAULTS.chance,
        cooldownSeconds: DEFAULTS.cooldownSeconds,
        hrefs: [],
        fired: 0,
        neutralized: 0
    };

    // Anchors the ad networks inject to hijack clicks. Kept deliberately
    // narrow: a real creative link inside an ad iframe is never touched.
    const CANDIDATE = [
        'a#lkds',
        'a[href*="redirect?target="]',
        'a[href*="eardepth"]',
        'a[href*="araplhn"]',
        'a[href*="bauval.org/25"]'
    ].join(',');

    function remember(a) {
        const href = a.getAttribute('href') || '';
        if (!href || href.startsWith('javascript:') || href.startsWith('#')) return;
        if (!state.hrefs.includes(href)) state.hrefs.push(href);

        // Only neutralise it if it actually covers the page; small, visible
        // ad links (social bar buttons) stay exactly as they were.
        const r = a.getBoundingClientRect();
        const coversViewport = r.width * r.height > window.innerWidth * window.innerHeight * 0.45;

        if (coversViewport && a.dataset.aetherCatcher !== '1') {
            a.dataset.aetherCatcher = '1';
            a.style.setProperty('pointer-events', 'none', 'important');
            a.setAttribute('tabindex', '-1');
            a.setAttribute('aria-hidden', 'true');
            state.neutralized++;
        }
    }

    function scan(root) {
        if (!root || !root.querySelectorAll) return;
        root.querySelectorAll(CANDIDATE).forEach(remember);
    }

    // The networks insert their catcher whenever they like, so keep watching.
    const observer = new MutationObserver((records) => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.matches && node.matches(CANDIDATE)) remember(node);
                scan(node);
            }
        }
    });

    function startWatching() {
        scan(document);
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    function lastFired() {
        try { return Number(sessionStorage.getItem(STORE_KEY) || 0); } catch (e) { return 0; }
    }

    function canFire() {
        if (!state.enabled || !state.hrefs.length) return false;
        return Date.now() - lastFired() >= state.cooldownSeconds * 1000;
    }

    function fire() {
        if (!canFire()) return null;
        const href = state.hrefs[state.hrefs.length - 1];
        let win = null;
        try {
            win = window.open(href, '_blank', 'noopener,noreferrer');
        } catch (e) {
            return null;
        }
        // If the browser blocked the tab, don't start the cooldown.
        if (!win) return null;
        try { sessionStorage.setItem(STORE_KEY, String(Date.now())); } catch (e) {}
        state.fired++;
        return href;
    }

    document.addEventListener('click', (event) => {
        if (!state.enabled) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (event.target && event.target.closest &&
            event.target.closest('#specter-adblock-overlay, #build-overlay')) return;
        if (Math.random() > state.chance) return;
        fire();
    }, { capture: false, passive: true });

    // Optional tuning block in data/ads.json:
    //   "clickPopunder": { "enabled": true, "chance": 0.22, "cooldownSeconds": 120 }
    fetch('data/ads.json', { cache: 'no-cache' })
        .then((res) => (res.ok ? res.json() : null))
        .then((cfg) => {
            if (!cfg) return;
            if (cfg.enabled === false) state.enabled = false;
            const c = cfg.clickPopunder;
            if (!c || typeof c !== 'object') return;
            if (typeof c.enabled === 'boolean') state.enabled = c.enabled;
            if (typeof c.chance === 'number') state.chance = Math.min(Math.max(c.chance, 0), 1);
            if (typeof c.cooldownSeconds === 'number') state.cooldownSeconds = Math.max(0, c.cooldownSeconds);
        })
        .catch(() => {});

    startWatching();

    // Small hook so this behaviour can be inspected without waiting on luck.
    window.aetherAdClicks = { state, fire, canFire, scan };
})();
