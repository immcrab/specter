(function () {
  'use strict';
  if (window.kiwiGoBackInstalled) return;
  window.kiwiGoBackInstalled = true;
  var typed = '', last = 0, leaving = false;
  function goBack() {
    if (leaving) return;
    // Let the trusted outer Kiwi document perform navigation, not a sandbox.
    try {
      if (window.parent !== window && typeof window.parent.kiwiGoBack === 'function') {
        window.parent.kiwiGoBack();
        return;
      }
    } catch (_) {}
    leaving = true;
    window.location.assign('/?kiwi-start=1');
  }
  window.kiwiGoBack = goBack;
  function onKey(event) {
    var target = event.target;
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing ||
        (target && (target.isContentEditable ||
          (target.closest && target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))))) {
      typed = '';
      return;
    }
    if (event.repeat || event.key === 'Shift') return;
    if (event.key.length !== 1) { typed = ''; return; }
    var now = Date.now();
    if (now - last > 3000) typed = '';
    last = now;
    typed = (typed + event.key.toLowerCase()).slice(-6);
    if (typed === 'goback') { typed = ''; goBack(); }
  }
  window.addEventListener('keydown', onKey);
  // Same-origin local game content may own focus. Never read external frames.
  var attached = new WeakSet();
  function watchFrame(frame) {
    if (attached.has(frame)) return;
    attached.add(frame);
    function attach() {
      try {
        var child = frame.contentWindow;
        if (!child || child.kiwiGoBackInstalled) return;
        child.document; // Throws across an origin boundary.
        child.addEventListener('keydown', onKey);
      } catch (_) {}
    }
    frame.addEventListener('load', attach);
    attach();
  }
  function scan(node) {
    if (node.tagName === 'IFRAME') watchFrame(node);
    if (node.querySelectorAll) node.querySelectorAll('iframe').forEach(watchFrame);
  }
  scan(document);
  new MutationObserver(function (records) {
    records.forEach(function (record) { record.addedNodes.forEach(scan); });
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
