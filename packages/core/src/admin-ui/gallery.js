// Lọc tile theo ô tìm kiếm (client-side)
(function () {
  var q = document.getElementById('q');
  if (!q) return;
  var grid = document.querySelector('.grid');
  var nores = document.getElementById('noRes');
  var tiles = Array.prototype.slice.call(grid.querySelectorAll('.tile'));

  function norm(s) {
    return (s || '').toString().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // bỏ dấu tiếng Việt
      .replace(/đ/g, 'd');
  }

  tiles.forEach(function (t) {
    t.dataset._k = norm(t.dataset.name || t.textContent);
  });

  q.addEventListener('input', function () {
    var v = norm(q.value.trim());
    var n = 0;
    tiles.forEach(function (t) {
      var hit = !v || t.dataset._k.indexOf(v) !== -1;
      t.style.display = hit ? '' : 'none';
      if (hit) n++;
    });
    if (nores) nores.style.display = n ? 'none' : 'block';
  });
})();
