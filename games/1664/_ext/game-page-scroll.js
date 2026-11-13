(function () {
  'use strict';
  var game = document.getElementById('kiwiGame');
  if (!game || !document.querySelector('.kiwi-stage')) return;
  var root = document.documentElement;
  function lock() { root.classList.add('kiwi-frame-scroll-locked'); }
  function unlock() { root.classList.remove('kiwi-frame-scroll-locked'); }
  // :hover alone is not reliable across iframe document boundaries. Track
  // entry on the iframe element and release on input elsewhere in the wrapper.
  game.addEventListener('pointerenter', lock);
  game.addEventListener('mouseenter', lock);
  document.addEventListener('pointermove', function (event) {
    var bounds = game.getBoundingClientRect();
    if (event.clientX >= bounds.left && event.clientX < bounds.right &&
        event.clientY >= bounds.top && event.clientY < bounds.bottom) lock();
    else unlock();
  }, { passive: true });
  document.addEventListener('wheel', function (event) {
    if (event.target !== game) unlock();
  }, { capture: true, passive: true });
  window.addEventListener('blur', function () {
    if (document.activeElement === game) lock();
  });
  window.addEventListener('pagehide', unlock);
  // No wheel interception or forwarding inside the game; its native scrolling
  // remains independent of this wrapper, including cross-origin documents.
}());
