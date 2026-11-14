/* ══════════════════════════════════════════════════════════════════════
   Aether — click shield
   ----------------------------------------------------------------------
   Adsterra's site popunder ships a full-viewport <a> that catches every
   click on the page, so a click anywhere — not just a click on an ad —
   sent the tab to an ad. That behaviour is gone:

     • the injected catcher anchor is kept, but made click-through, so
       buttons, games and the guide behave normally;
     • any full-viewport wrapper around it is made click-through too;
     • nothing in this file ever opens a tab.

   The in-page units (banners, native, pre-roll) still run unchanged and
   open their destination only when you click the ad itself.
   ══════════════════════════════════════════════════════════════════════ */
(() => {
    'use strict';

    const state = {
        neutralized: 0,
        shields: 0
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

    // The networks also wrap the catcher in a max-z-index div, which keeps
    // eating clicks after the anchor itself is tamed. Make any full-viewport
    // wrapper click-through too, so everything underneath behaves normally.
    function shieldAncestors(a) {
        let node = a.parentElement;
        while (node && node !== document.body) {
            const r = node.getBoundingClientRect();
            const coversViewport = r.width * r.height >= window.innerWidth * window.innerHeight * 0.85;
            if (coversViewport && node.dataset.aetherShield !== '1') {
                node.dataset.aetherShield = '1';
                node.style.setProperty('pointer-events', 'none', 'important');
                state.shields++;
            }
            node = node.parentElement;
        }
    }

    function neutralize(a) {
        const href = a.getAttribute('href') || '';
        if (!href || href.startsWith('javascript:') || href.startsWith('#')) return;

        // Only neutralise it if it actually covers the page; small, visible
        // ad links (social bar buttons) stay exactly as they were.
        const r = a.getBoundingClientRect();
        const coversViewport = r.width * r.height > window.innerWidth * window.innerHeight * 0.45;
        if (!coversViewport || a.dataset.aetherCatcher === '1') return;

        a.dataset.aetherCatcher = '1';
        a.style.setProperty('pointer-events', 'none', 'important');
        a.setAttribute('tabindex', '-1');
        a.setAttribute('aria-hidden', 'true');
        state.neutralized++;
        shieldAncestors(a);
    }

    function scan(root) {
        if (!root || !root.querySelectorAll) return;
        root.querySelectorAll(CANDIDATE).forEach(neutralize);
    }

    // The networks insert their catcher whenever they like, so keep watching.
    const observer = new MutationObserver((records) => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.matches && node.matches(CANDIDATE)) neutralize(node);
                scan(node);
            }
        }
    });

    function startWatching() {
        scan(document);
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    startWatching();

    // Small hook so the shield can be inspected without waiting on luck.
    window.aetherClickShield = { state, scan };
})();
