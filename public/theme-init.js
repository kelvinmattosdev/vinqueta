// Script síncrono externo: aplica o tema antes da pintura sem relaxar a CSP.
(function () {
  var preference = 'system';
  try {
    var saved = localStorage.getItem('vinqueta.theme') || localStorage.getItem('jau.theme');
    if (saved === 'light' || saved === 'dark' || saved === 'system') preference = saved;
  } catch (_) { /* Armazenamento indisponível: acompanha o sistema. */ }
  var dark = preference === 'dark' || (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#151b18' : '#f3f3f3';
})();
