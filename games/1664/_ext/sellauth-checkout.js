(function () {
  'use strict';

  if (window.__kiwiSellAuthModifierGuard) return;
  window.__kiwiSellAuthModifierGuard = true;

  /* SellAuth's documented data-attribute embed handles ordinary clicks.
     Stop its delegated handler only for browser-native modified clicks so the
     hosted checkout href/target remains a real new-tab fallback. This script
     must run before v3.min.js registers its own capture listener. */
  document.addEventListener('click', function (event) {
    if (!(event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) return;
    var source = event.target;
    var trigger = source && source.closest && source.closest('[data-sellauth-shop]');
    if (trigger) event.stopImmediatePropagation();
  }, true);
})();