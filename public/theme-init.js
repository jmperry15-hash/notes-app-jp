// Applies the saved theme before first paint so the app never flashes the wrong colours.
(function () {
  var theme = 'dark';
  try {
    var prefs = JSON.parse(localStorage.getItem('folio.prefs') || '{}');
    theme = prefs.theme || 'system';
    if (theme === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
  } catch (e) {
    theme = 'dark';
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
