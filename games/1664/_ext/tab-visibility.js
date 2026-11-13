(function () {
  'use strict';
  // The outer education shell owns the tab when Kiwi is embedded.
  if (window.top !== window || window.kiwiTabVisibilityInstalled || window.kiwiStartingPage) return;
  window.kiwiTabVisibilityInstalled = true;
  var blankTitle = '\u3164';
  var iconUrl = '_ext/attached_assets/image_1794074921995.png';
  var classroomTitle = 'Home - Classroom';
  var classroomIcon = '_ext/attached_assets/image_1792606461959.png';
  var appliedTitle = null;
  var appliedIcon = null;
  var sponsoredUntil = 0;
  var sponsoredHidden = false;
  var enabled = false;
  var savedTitle = null;
  var savedIcons = new Map();
  var temporaryIcon = null;
  var attrs = ['href', 'type', 'sizes', 'media'];
  function storedMode() {
    try { return localStorage.getItem('kiwi-games-only') === '1'; } catch (_) { return false; }
  }
  enabled = storedMode() || document.documentElement.classList.contains('kiwi-games-only');
  function observe() {
    observer.observe(document.head, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['href', 'rel', 'type', 'sizes', 'media'] });
  }
  function update() {
    observer.disconnect();
    var learningHubVisible = window.kiwiLearningHubShell &&
      !document.documentElement.classList.contains('kiwi-app-open');
    var targetTitle = enabled ? blankTitle :
      (document.hidden && !sponsoredHidden && !learningHubVisible ? classroomTitle : null);
    var targetIcon = enabled ? iconUrl : classroomIcon;
    if (targetTitle !== null) {
      if (document.title !== appliedTitle) savedTitle = document.title;
      var icons = Array.from(document.querySelectorAll('link[rel~="icon"]'));
      if (!icons.length) {
        temporaryIcon = document.createElement('link');
        temporaryIcon.rel = 'icon';
        document.head.appendChild(temporaryIcon);
        icons.push(temporaryIcon);
      }
      icons.forEach(function (icon) {
        if (icon !== temporaryIcon && icon.getAttribute('href') !== appliedIcon) {
          var original = {};
          attrs.forEach(function (name) { original[name] = icon.getAttribute(name); });
          savedIcons.set(icon, original);
        }
        icon.setAttribute('href', targetIcon);
        icon.setAttribute('type', 'image/png');
        icon.removeAttribute('sizes');
        icon.removeAttribute('media');
      });
      document.title = targetTitle;
      appliedTitle = targetTitle;
      appliedIcon = targetIcon;
    } else if (savedTitle !== null) {
      document.title = savedTitle;
      savedTitle = null;
      savedIcons.forEach(function (original, icon) {
        attrs.forEach(function (name) {
          if (original[name] === null) icon.removeAttribute(name);
          else icon.setAttribute(name, original[name]);
        });
      });
      savedIcons.clear();
      if (temporaryIcon) temporaryIcon.remove();
      temporaryIcon = null;
      appliedTitle = null;
      appliedIcon = null;
    }
    observe();
  }
  var observer = new MutationObserver(update);
  window.kiwiSetTabGamesOnly = function (value) { enabled = !!value; update(); };
  // Keep Kiwi branding for the sponsor's single departure, not later tab switches.
  window.kiwiBeginSponsoredDeparture = function () {
    sponsoredUntil = document.hidden ? 0 : Date.now() + 15000;
    if (document.hidden) sponsoredHidden = true;
    update();
    return function () { sponsoredUntil = 0; };
  };
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      sponsoredHidden = Date.now() < sponsoredUntil;
      sponsoredUntil = 0;
    } else {
      sponsoredHidden = false;
    }
    update();
  });
  window.addEventListener('storage', function (event) {
    if (event.key === 'kiwi-games-only' || event.key === null)
      window.kiwiSetTabGamesOnly(storedMode());
  });
  window.addEventListener('pageshow', update);
  update();
})();
