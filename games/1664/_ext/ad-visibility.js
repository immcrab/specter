(function () {
  'use strict';

  var bait, control;
  var settled = false;
  var requestBlocked = false;
  var requestPending = false;
  var requestEvidence = 'unknown';
  var probeBody = '/* kiwi-request-probe-v1 */';
  // Reuse the last result in this tab while the fresh check runs. This avoids
  // collapsing/re-expanding every game wrapper on normal navigation.
  try {
    var previous = JSON.parse(sessionStorage.getItem('kiwi-ad-check') || 'null');
    if (previous && Date.now() - previous.at < 300000) {
      document.documentElement.classList.toggle('kiwi-ads-clear', previous.blocked === false);
      document.documentElement.classList.toggle('kiwi-blocked-ads', previous.blocked === true);
    }
  } catch (_) {}

  function scriptResult(url) {
    return new Promise(function (resolve) {
      var script = document.createElement('script');
      var done = false;
      var timeout;
      function finish(result) {
        if (done) return;
        done = true;
        window.clearTimeout(timeout);
        script.onload = script.onerror = null;
        script.remove();
        resolve(result);
      }
      script.onload = function () { finish('loaded'); };
      script.onerror = function () { finish('error'); };
      timeout = window.setTimeout(function () { finish('timeout'); }, 4000);
      script.src = url;
      script.async = true;
      try { document.head.appendChild(script); } catch (_) { finish('error'); }
    });
  }

  async function checkRequests(round) {
    var suffix = '?kiwi-probe=' + Date.now() + '-' + round;
    // EasyList's _ext/ads/cbr.js$script rule blocks script requests, not fetch.
    // A successful fetch of the SAME path confirms it exists and is healthy.
    var adUrl = '_ext/ads/cbr.js' + suffix;
    var results = await Promise.all([
      scriptResult('_ext/kiwi-request-control.js' + suffix),
      scriptResult(adUrl),
    ]);
    if (results[0] === 'loaded' && results[1] === 'loaded') {
      requestEvidence = 'clear';
      return false;
    }
    if (results[0] !== 'loaded' || results[1] !== 'error') {
      requestEvidence = 'unknown';
      return false;
    }
    var controller = new AbortController();
    var timeout = window.setTimeout(function () { controller.abort(); }, 4000);
    try {
      var response = await window.fetch(adUrl, { cache: 'no-store', signal: controller.signal });
      var blocked = response.ok && (await response.text()).trim() === probeBody;
      requestEvidence = blocked ? 'blocked' : 'unknown';
      return blocked;
    } catch (_) { requestEvidence = 'unknown'; return false; }
    finally { window.clearTimeout(timeout); }
  }

  function startRequestCheck() {
    if (!window.fetch || !window.AbortController || !document.head) return;
    requestPending = true;
    // Require the selective failure twice; one script error is not sufficient.
    window.kiwiAdBlockReady = checkRequests(1).then(function (blocked) {
      return blocked ? checkRequests(2) : false;
    }).then(function (blocked) {
      requestBlocked = blocked;
      requestPending = false;
      refresh();
    }, function () {
      requestPending = false;
      refresh();
    });
  }
  function mountProbes() {
    if (!document.body || control) return;
    bait = document.createElement('div');
    control = document.createElement('div');
    bait.className = 'adsbox ad-banner adsbygoogle pub_300x250';
    bait.id = 'ad-banner';
    bait.setAttribute('aria-hidden', 'true');
    control.setAttribute('aria-hidden', 'true');
    bait.style.cssText = control.style.cssText =
      'position:absolute;left:-10000px;top:-10000px;width:1px;height:1px;pointer-events:none;';
    document.body.appendChild(control);
    document.body.appendChild(bait);
    // Keep these mounted: extensions often inspect new DOM nodes asynchronously.
    // Recreating/removing a bait in the same JS turn never gives them a chance.
  }

  function detectsAdBlock() {
    // Only confirmed selective request filtering, never an ordinary failure.
    if (requestBlocked) return true;
    try {
      mountProbes();
      if (!control) return null;
      var controlStyle = window.getComputedStyle(control);
      if (!control.isConnected || !control.getBoundingClientRect().height ||
          controlStyle.visibility === 'hidden' || controlStyle.opacity === '0') return null;
      var baitStyle = window.getComputedStyle(bait);
      var blocked = !bait.isConnected || !bait.getBoundingClientRect().height ||
        baitStyle.visibility === 'hidden' || baitStyle.opacity === '0';
      // Do not choose the normal-user popup path while extension filtering is
      // still settling. A positive blocking signal can be applied immediately.
      return blocked ? true : settled && !requestPending ? false : null;
    } catch (_) { return null; }
  }

  // Separate from ad-free mode: hiding containers must not disable the
  // sponsored-link behavior or persist an ad-free preference.
  var style = document.createElement('style');
  style.textContent =
    'html.kiwi-blocked-ads .bottom-ad-container,' +
    'html.kiwi-blocked-ads .kiwi-game-top-ad,' +
    'html.kiwi-blocked-ads .side-ad,' +
    'html.kiwi-blocked-ads .mrec-ad,' +
    'html.kiwi-blocked-ads .home-inline-ad,' +
    'html.kiwi-blocked-ads .home-bottom-ad,' +
    'html.kiwi-blocked-ads .mobile-bottom-ad{display:none!important;}' +
    'html.kiwi-blocked-ads .home-inline-ad + [data-testid="grid-games"],' +
    'html.kiwi-blocked-ads .home-inline-ad + [data-testid="grid-skeleton"]{margin-top:120px!important;}' +
    // The normal layout reserves half a billboard and extends the document.
    // Restore a viewport-sized game layout only on blocked game wrappers.
    'html.kiwi-blocked-ads:has(.kiwi-stage){height:100%!important;overflow:hidden!important;}' +
    'html.kiwi-blocked-ads:has(.kiwi-stage) body{height:100vh!important;min-height:0!important;overflow:hidden!important;}' +
    'html.kiwi-blocked-ads .kiwi-stage{position:fixed!important;top:54px!important;left:10px!important;right:10px!important;bottom:54px!important;height:auto!important;}' +
    'html.kiwi-blocked-ads .kiwi-footer{position:fixed!important;top:auto!important;bottom:0!important;height:44px!important;}';
  document.documentElement.appendChild(style);

  window.kiwiDetectAdBlock = function () {
    var blocked = detectsAdBlock();
    if (blocked !== null) {
      document.documentElement.classList.toggle('kiwi-blocked-ads', blocked);
      document.documentElement.classList.toggle('kiwi-ads-clear', blocked === false);
      try {
        sessionStorage.setItem('kiwi-ad-check', JSON.stringify({ blocked: blocked, at: Date.now() }));
      } catch (_) {}
    }
    return blocked;
  };
  // Diagnostic only: preserve existing visitor behavior when requests are inconclusive.
  window.kiwiAdBlockRequestEvidence = function () {
    return requestPending ? 'pending' : requestEvidence;
  };
  function refresh() { window.kiwiDetectAdBlock(); }
  function ready() {
    startRequestCheck();
    refresh();
    window.setTimeout(function () { settled = true; refresh(); }, 250);
    window.setTimeout(refresh, 1000);
    window.setTimeout(refresh, 3000);
    window.setTimeout(refresh, 10000);
    // Detect late display changes without polling the whole page.
    if (window.ResizeObserver && bait) {
      var observer = new window.ResizeObserver(refresh);
      observer.observe(bait);
      observer.observe(control);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
  window.addEventListener('pageshow', refresh);
  window.addEventListener('focus', refresh);
}());