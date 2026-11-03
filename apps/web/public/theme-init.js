// Apply a saved manual theme before first paint. Without one the CSS follows
// prefers-color-scheme. Storage may be unavailable (private mode, blocked).
(function () {
  try {
    var t = window.localStorage.getItem('remode.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch {
    /* ignore */
  }
})();
