// starting-page-return.js
// On "gated" versions of the site (a separate starting page that unlocks the
// kiwi app via a cookie, e.g. the ClassLink version), make the top-left kiwi
// logo/text send the user back to that starting page instead of just staying
// on the kiwi homepage. Generic: keys off the presence of an unlock cookie, so
// any future gated version works the same way with no extra code.
(function () {
  // Gated versions of the site. Each has an unlock cookie plus the branding
  // (tab title + favicon) that should carry across every kiwi page while
  // unlocked. Add future gated versions here.
  var GATES = [{
    cookie: 'skyward_unlock',
    value: '1',
    title: 'kiwi | education',
    favicon: '_ext/Skyward_files/skyicon.ico',
    relock: '/skyward-relock',
    windowNamePrefix: 'kiwi-gate:skyward_unlock@'
  }];

  function activeGate() {
    // Response-sandboxed game wrappers have an opaque origin and cannot read
    // cookies/localStorage. Their server response supplies this non-secret gate
    // name after seeing the top-level request's unlock cookie.
    if (window.KIWI_FORCED_GATE) {
      for (var f = 0; f < GATES.length; f++) {
        if (GATES[f].cookie === window.KIWI_FORCED_GATE) return GATES[f];
      }
    }
    var jar = '';
    try { jar = document.cookie || ''; } catch (e) {}
    for (var i = 0; i < GATES.length; i++) {
      var g = GATES[i];
      var re = new RegExp('(?:^|;\\s*)' + g.cookie + '=' + g.value + '(?:;|$)');
      if (re.test(jar)) return g;
      // Cookies are blocked on many school browsers; the unlock is then kept
      // in localStorage (same key) by the starting page.
      try { if (localStorage.getItem(g.cookie) === g.value) return g; } catch (e) {}
    }
    // Same-tab fallback for response-sandboxed game documents. Scope the marker
    // to its originating hostname so it cannot leak Skyward branding/relock
    // into ClassLink, IXL, Quizlet, or normal Kiwi after cross-domain navigation.
    var currentWindowName = '';
    try { currentWindowName = window.name || ''; } catch (e) {}
    var host = location.hostname.toLowerCase();
    for (var n = 0; n < GATES.length; n++) {
      if (GATES[n].windowNamePrefix &&
          currentWindowName === GATES[n].windowNamePrefix + host) return GATES[n];
    }
    return null;
  }

  var gate = activeGate();
  if (!gate) return; // normal (non-gated) site: do nothing.

  // ── Branding: make every kiwi page use the starting page's tab title + favicon.
  function applyFavicon(href) {
    if (!href) return;
    var links = document.querySelectorAll(
      "link[rel~='icon'], link[rel='shortcut icon'], link[rel='apple-touch-icon']"
    );
    for (var i = 0; i < links.length; i++) links[i].parentNode.removeChild(links[i]);
    var l = document.createElement('link');
    l.rel = 'icon';
    l.href = href;
    (document.head || document.documentElement).appendChild(l);
  }
  // ── Title: physically pin the <title> so the kiwi app can never change it.
  function setTitleText(t) {
    var el = document.querySelector('title');
    if (!el) {
      el = document.createElement('title');
      (document.head || document.documentElement).appendChild(el);
    }
    if (el.textContent !== t) el.textContent = t;
  }
  if (gate.title) {
    setTitleText(gate.title);
    // Intercept every `document.title = ...` write so the app's attempts to set
    // it (e.g. on the home button / route changes) are forced back instantly —
    // no flicker, because our value wins synchronously in the same assignment.
    try {
      Object.defineProperty(document, 'title', {
        configurable: true,
        get: function () { return gate.title; },
        set: function () { setTitleText(gate.title); }
      });
    } catch (e) {}
    // Catch direct <title> text edits or head/title replacement that bypass
    // the document.title setter.
    var repin = function () { setTitleText(gate.title); };
    if (document.head) {
      new MutationObserver(repin).observe(document.head, {
        childList: true, characterData: true, subtree: true
      });
    }
  }

  // ── Favicon: apply once and re-apply if the app swaps icon links.
  applyFavicon(gate.favicon);
  function enforceFavicon() {
    if (!gate.favicon) return;
    var links = document.querySelectorAll(
      "link[rel~='icon'], link[rel='shortcut icon'], link[rel='apple-touch-icon']"
    );
    var expectedCount = 0;
    var hasOtherIcon = false;
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute('href') === gate.favicon) expectedCount++;
      else hasOtherIcon = true;
    }
    if (hasOtherIcon || expectedCount !== 1 || links.length !== 1) {
      applyFavicon(gate.favicon);
    }
  }
  if (gate.favicon && document.head) {
    new MutationObserver(enforceFavicon).observe(document.head, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'rel']
    });
  }
  setInterval(enforceFavicon, 500);
  document.addEventListener('visibilitychange', enforceFavicon);

  function backToStart(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    // Clear the unlock cookie (both the host-only and domain-wide variants that
    // the starting page set) so the server serves the starting page again.
    try { document.cookie = gate.cookie + '=; path=/; max-age=0; samesite=lax'; } catch (e) {}
    var h = location.hostname.replace(/^www\./, '');
    if (h.indexOf('.') > 0 && !/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
      try {
        document.cookie = gate.cookie + '=; domain=.' + h + '; path=/; max-age=0; samesite=lax';
      } catch (e) {}
    }
    // Also clear the localStorage unlock, or the starting page would instantly
    // forward right back to kiwi.
    try { localStorage.removeItem(gate.cookie); } catch (e) {}
    try {
      if (gate.windowNamePrefix &&
          window.name.indexOf(gate.windowNamePrefix) === 0) window.name = '';
    } catch (e) {}
    location.replace(gate.relock || '/');
  }

  // The kiwi logo + brand text live in an anchor in the top bar that contains
  // <img alt="kiwi logo">. Match by ELEMENT, not by pixel coordinates —
  // coordinates break under browser zoom / display scaling (e.g. Chromebooks),
  // letting the app's own logo link win and navigate to the kiwi homepage.
  function isBrandClick(e) {
    var path = (e.composedPath && e.composedPath()) || [];
    var node = path.length ? null : e.target;
    for (var i = 0; i < (path.length || 1); i++) {
      var el = path.length ? path[i] : node;
      if (!el || !el.tagName) continue;
      if (el.tagName === 'IMG' && el.alt === 'kiwi logo') return true;
      // Only the brand ANCHOR itself — never generic containers (they'd match
      // every click on the page, since the whole app contains the logo).
      if (el.tagName === 'A' && el.querySelector &&
          el.querySelector('img[alt="kiwi logo"]')) return true;
    }
    return false;
  }
  // Pin the actual home/brand href as well as intercepting clicks. The latter
  // remains a capture-phase fallback when the React app rewrites this anchor.
  function pinBrandLink() {
    if (!gate.relock) return;
    var anchors = document.querySelectorAll('a');
    for (var i = 0; i < anchors.length; i++) {
      if (anchors[i].querySelector && anchors[i].querySelector('img[alt="kiwi logo"]')) {
        anchors[i].setAttribute('href', gate.relock);
      }
    }
  }
  pinBrandLink();
  if (gate.relock && document.documentElement) {
    new MutationObserver(pinBrandLink).observe(document.documentElement, {
      childList: true, subtree: true
    });
  }
  document.addEventListener('click', function (e) {
    // Element match (robust) with the old corner hitbox as a fallback.
    if (isBrandClick(e) ||
        (e.clientY <= 74 && e.clientX <= 220 && e.clientX >= 0 && e.clientY >= 0)) {
      backToStart(e);
    }
  }, true);
})();
