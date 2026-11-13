(function () {
  'use strict';
  var destination = 'https://amrox.org/4/d61a36e21493df10e16e1126df30d901';
  var adblockDestination = 'https://amrox.org/4/96178afd5633be10ea575bdd1431f051';
  var returnKey = 'kiwi-sponsor-overlay-return';
  var pendingKey = 'kiwi-sponsor-pending-game';
  function appWindow() {
    var shell = document.getElementById('kiwi-app-frame');
    return shell ? shell.contentWindow : window;
  }
  window.kiwiSwapGameSponsor = function (caller) {
    // All navigation executes in this trusted document's realm, not in the
    // sandboxed wrapper. Never grant navigation permissions to game content.
    var app = appWindow();
    var wrapper = app.document.getElementById('kiwi-game-frame');
    if (!wrapper || wrapper.contentWindow !== caller ||
        !/^\/_\/\d+\/(?:index\.html)?$/.test(caller.location.pathname)) return false;
    var resumeKey = 'kiwi-sponsor-return:' + caller.location.pathname;
    var previous = sessionStorage.getItem(resumeKey);
    var previousOverlay = sessionStorage.getItem(returnKey);
    var homeUrl = window.location.origin + '/?kiwi-frame=1';
    var tab;
    try {
      if (typeof window.kiwiBeginSponsoredDeparture === 'function') window.kiwiBeginSponsoredDeparture();
      sessionStorage.setItem(resumeKey, String(Date.now()));
      sessionStorage.setItem(returnKey, JSON.stringify({
        path: caller.location.pathname + caller.location.search, at: Date.now()
      }));
      var name = 'kiwi_game_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      tab = window.open('about:blank', name);
      if (!tab || tab.closed) return false;
      try { tab.history.replaceState({ previous: homeUrl }, '', homeUrl); } catch (_) {}
      try { tab.location = homeUrl; }
      catch (_) { tab = window.open(homeUrl, name); }
      if (!tab || tab.closed) return false;
      try { tab.focus(); } catch (_) {}
      window.location.href = adblockDestination;
      return true;
    } catch (error) {
      console.warn('Kiwi sponsor tab swap failed:', error);
      try { if (tab) tab.close(); } catch (_) {}
      return false;
    } finally {
      if (previous === null) sessionStorage.removeItem(resumeKey);
      else sessionStorage.setItem(resumeKey, previous);
      if (previousOverlay === null) sessionStorage.removeItem(returnKey);
      else sessionStorage.setItem(returnKey, previousOverlay);
    }
  };
  window.kiwiOpenGameSponsor = function (caller, sameTab) {
    // Only the trusted first-party wrapper, never its nested game or ad frames.
    var app = appWindow();
    var wrapper = app.document.getElementById('kiwi-game-frame');
    if (!wrapper || wrapper.contentWindow !== caller ||
        !/^\/_\/\d+\/(?:index\.html)?$/.test(caller.location.pathname)) return false;
    if (typeof window.kiwiBeginSponsoredDeparture === 'function') window.kiwiBeginSponsoredDeparture();
    if (sameTab) {
      sessionStorage.setItem(returnKey, JSON.stringify({
        path: caller.location.pathname + caller.location.search, at: Date.now()
      }));
      window.location.assign(adblockDestination);
    } else {
      var popup = window.open(destination, '_blank',
        'popup=yes,left=' + (window.screen.availLeft || 0) + ',top=' + (window.screen.availTop || 0) +
        ',width=' + window.screen.availWidth + ',height=' + window.screen.availHeight);
      if (popup) popup.opener = null;
    }
    return true;
  };
  function restore() {
    if (window.kiwiStartingPage) return;
    if (window !== window.top) return;
    var saved;
    try { saved = JSON.parse(sessionStorage.getItem(returnKey)); } catch (_) {}
    if (!saved) {
      try { saved = JSON.parse(localStorage.getItem(pendingKey)); } catch (_) {}
    }
    if (!saved) return;
    if (sessionStorage.getItem(returnKey)) {
      var cleanUrl = new URL(window.location.href);
      if (cleanUrl.searchParams.get('kiwi-frame') === '1') {
        cleanUrl.searchParams.delete('kiwi-frame');
        window.history.replaceState(window.history.state, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
      }
    }
    try { window.opener = null; } catch (_) {}
    if (!Number.isFinite(saved.at) || !/^\/_\/\d+\/(?:index\.html)?(?:\?|$)/.test(saved.path)) {
      sessionStorage.removeItem(returnKey);
      try { localStorage.removeItem(pendingKey); } catch (_) {}
      return;
    }
    var attempts = 0, opened = false, stableSince = 0;
    var timer = setInterval(function () {
      try {
        var app = appWindow();
        var existing = app.document.getElementById('kiwi-game-frame');
        if (existing && existing.contentWindow.location.pathname === saved.path.split('?')[0]) {
          var game = existing.contentDocument.getElementById('kiwiGame');
          if (game && game.getAttribute('src')) {
            if (!stableSince) stableSince = Date.now();
            // Back can fire pageshow before the app's popstate reload.
            // Keep the return marker until that reload has settled.
            if (Date.now() - stableSince > 2000) {
              try {
                var pending = JSON.parse(localStorage.getItem(pendingKey));
                if (pending && pending.path === saved.path && pending.at === saved.at) localStorage.removeItem(pendingKey);
              } catch (_) {}
              sessionStorage.removeItem(returnKey); clearInterval(timer);
            }
          }
        } else if (!opened && typeof app.kiwiOpen === 'function') {
          sessionStorage.setItem('kiwi-sponsor-return:' + saved.path.split('?')[0], String(Date.now()));
          opened = true;
          app.kiwiOpen(saved.path, 'kiwi');
        }
      } catch (_) {}
      if (++attempts > 100) clearInterval(timer);
    }, 100);
  }
  window.addEventListener('pageshow', restore);
}());
