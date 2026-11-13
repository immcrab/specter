/* Owner can toggle all ads on/off site-wide (persists via localStorage).
   The secret code is validated server-side — this file contains no code.
   The code is 4 digits; only consecutive digit keystrokes
   are buffered so ordinary typing never triggers a server request. */
(function () {
  var KEY = 'kiwi-adfree';
  var CODE_LEN = 4;
  var hexRe = /^[0-9]$/;
  var hexBuf = '';    /* only consecutive hex chars accumulate here */
  var pending = false;

  var st = document.createElement('style');
  st.textContent =
    'html.kiwi-adfree .bottom-ad-container,' +
    'html.kiwi-adfree .side-ad,' +
    'html.kiwi-adfree .mrec-ad,' +
    'html.kiwi-adfree .home-inline-ad,' +
    'html.kiwi-adfree .home-bottom-ad,' +
    'html.kiwi-adfree .mobile-bottom-ad{display:none !important;}' +
    'html.kiwi-adfree .home-inline-ad + [data-testid="grid-games"],' +
    'html.kiwi-adfree .home-inline-ad + [data-testid="grid-skeleton"]{margin-top:120px !important;}' +
    'html.kiwi-adfree .kiwi-stage{top:54px !important;left:10px !important;right:10px !important;bottom:54px !important;}';
  document.documentElement.appendChild(st);

  function apply(on) {
    document.documentElement.classList.toggle('kiwi-adfree', on);
  }

  var on = false;
  try { on = localStorage.getItem(KEY) === '1'; } catch (e) {}
  apply(on);

  function checkServer(candidate) {
    if (pending) return;
    pending = true;
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/check-toggle', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      pending = false;
      try {
        var resp = JSON.parse(xhr.responseText);
        if (resp && resp.ok) {
          on = !on;
          try { on ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY); } catch (err) {}
          apply(on);
          /* Load-time-gated ad tags and the first-click opener need a reload
             when the secret toggle changes. */
          try { window.top.location.reload(); } catch (err) { location.reload(); }
        }
      } catch (e) {}
    };
    xhr.send(JSON.stringify({ code: candidate }));
  }

  function handler(e) {
    if (!e.key || e.key.length !== 1) return;
    if (hexRe.test(e.key)) {
      /* only hex chars advance the sequence */
      hexBuf += e.key;
      if (hexBuf.length === CODE_LEN) {
        checkServer(hexBuf);
        hexBuf = '';
      }
    } else {
      /* non-hex character breaks the sequence */
      hexBuf = '';
    }
  }

  function hook(win, depth) {
    try {
      if (!win) return;
      if (!win.__kiwiAdToggle) {
        win.__kiwiAdToggle = 1;
        win.addEventListener('keydown', handler, true);
      }
      if (depth > 0) scan(win.document, depth - 1);
    } catch (e) {}
  }

  function scan(doc, depth) {
    try {
      var frames = doc.querySelectorAll('iframe');
      for (var i = 0; i < frames.length; i++) hook(frames[i].contentWindow, depth);
    } catch (e) {}
  }

  hook(window, 0);
  setInterval(function () { scan(document, 2); }, 1500);
})();
