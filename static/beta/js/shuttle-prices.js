// The shuttle price table's sorting and the refresh button. Moved out of
// views/shuttle-prices.ejs (REARCH-07 step 5); the busy label is the
// #refreshBusy <template>, its spinner rendered by icon() on the server.
(function() {
  const filterBrand  = document.getElementById('filterBrand');
  const filterSource = document.getElementById('filterSource');
  const filterName   = document.getElementById('filterName');
  const tbody        = document.getElementById('shuttle-tbody');

  function applyFilters() {
    if (!tbody) return;
    const brand  = filterBrand  ? filterBrand.value  : '';
    const source = filterSource ? filterSource.value : '';
    const name   = filterName   ? filterName.value.toLowerCase() : '';
    Array.from(tbody.rows).forEach(row => {
      const show =
        (!brand  || row.dataset.brand  === brand)  &&
        (!source || row.dataset.source === source) &&
        (!name   || row.dataset.name.includes(name));
      row.style.display = show ? '' : 'none';
    });
  }

  if (filterBrand)  filterBrand.addEventListener('change', applyFilters);
  if (filterSource) filterSource.addEventListener('change', applyFilters);
  if (filterName)   filterName.addEventListener('input', applyFilters);

  // Column sort
  let sortCol = null, sortAsc = true;
  const table = document.getElementById('shuttle-table');
  if (table) {
    table.querySelectorAll('th[data-col]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (sortCol === col) { sortAsc = !sortAsc; } else { sortCol = col; sortAsc = true; }

        table.querySelectorAll('th[data-col]').forEach(t => {
          t.classList.remove('sort-active');
          const arrow = t.querySelector('.sort-arrow');
          if (arrow) arrow.textContent = '▲';
        });
        th.classList.add('sort-active');
        const arrow = th.querySelector('.sort-arrow');
        if (arrow) arrow.textContent = sortAsc ? '▲' : '▼';

        const rows = Array.from(tbody.rows);
        rows.sort((a, b) => {
          let va = a.dataset[col] || a.cells[colIndex(col)].textContent.trim();
          let vb = b.dataset[col] || b.cells[colIndex(col)].textContent.trim();
          const na = parseFloat(va), nb = parseFloat(vb);
          if (!isNaN(na) && !isNaN(nb)) return sortAsc ? na - nb : nb - na;
          return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
        });
        rows.forEach(r => tbody.appendChild(r));
      });
    });
  }

  function colIndex(col) {
    const map = { name:0, brand:1, source:2, p1:3, p5:4, p14:5, p25:6, p50:7 };
    return map[col] ?? 0;
  }

  // Spinner on refresh
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.closest('form').addEventListener('submit', () => {
      refreshBtn.innerHTML = document.getElementById('refreshBusy').innerHTML;
      refreshBtn.disabled = true;
    });
  }
})();
