(function () {
  'use strict';
  var key = 'kiwi-learning-entry-v1';
  var busy = {};
  window.kiwiLearningEntry = function (event, retry) {
    if (!['shown', 'returned'].includes(event) || navigator.doNotTrack === '1' ||
        navigator.globalPrivacyControl) return;
    var sample;
    try {
      sample = JSON.parse(localStorage.getItem(key));
      if (!sample && event === 'shown') {
        var bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        sample = { id: Array.from(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join(''), at: Date.now() };
        localStorage.setItem(key, JSON.stringify(sample));
      }
      if (!sample || !/^[a-f0-9]{32}$/.test(sample.id) ||
          Date.now() - sample.at > 34 * 86400000 || sample[event] || busy[event]) return;
    } catch (_) { return; }
    busy[event] = true;
    fetch('/api/site-metrics/learning-entry', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sample.id, event: event }), keepalive: true,
      credentials: 'same-origin'
    }).then(function (response) {
      if (!response.ok) throw new Error('Learning entry tracking unavailable');
      try {
        var current = JSON.parse(localStorage.getItem(key));
        if (current && current.id === sample.id) {
          current[event] = true;
          localStorage.setItem(key, JSON.stringify(current));
        }
      } catch (_) {}
      busy[event] = false;
    }).catch(function () {
      busy[event] = false;
      if (!retry) setTimeout(function () { window.kiwiLearningEntry(event, true); }, 2000);
    });
  };
})();
