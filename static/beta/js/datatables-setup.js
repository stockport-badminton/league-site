/* The DataTables set-up for the results/fixture tables and the stats tables, moved out of
 * views/datatables.ejs, views/datatables-stats.ejs and views/datatables-controls.ejs
 * (REARCH-07 step 5). The page says what it wants in a JSON block:
 *
 *   <script type="application/json" id="dt-config">
 *     { "kind": "results" | "stats", "csv": bool, "columnSearch": bool,
 *       "nearestDate": "…", "icons": { "eye": "<svg…>", "download": …, "search": … } }
 *
 * The icons are rendered server-side by icon() and passed in as markup, because the
 * button labels are HTML.
 */
(function () {
  'use strict';
  var el = document.getElementById('dt-config');
  if (!el) return;
  var cfg = JSON.parse(el.textContent);
  var icons = cfg.icons || {};

  /* The control band that sits directly above the table.
   *
   * `dom` puts DataTables' own controls into one row - buttons on the left, page size and
   * search on the right - instead of the bs4 default two-row layout. `B` is the Buttons
   * container, where the Columns dropdown (ColVis) renders.
   *
   * The table (and only the table) sits in the horizontally-scrolling .table-responsive
   * box. That box used to wrap these controls too, and since overflow-x:auto also clips
   * vertically, it cut the bottom off the Columns dropdown whenever the table was shorter
   * than the menu. The views use a plain .dt-table-shell wrapper and DataTables makes the
   * scroller here instead. */
  function controls(options) {
    options.dom = "<'dt-controls'<'dt-controls-left'B><'dt-controls-right'lf>>" +
      "<'table-responsive'rt>" +
      "<'dt-footer'<'dt-info'i><'dt-pager'p>>";
    options.language = {
      lengthMenu: 'Show _MENU_',
      search: '',
      searchPlaceholder: 'Search this page',
      buttons: { colvis: icons.eye + ' Columns' }
    };
    options.lengthMenu = [[10, 20, 50, 100, -1], [10, 20, 50, 100, 'All']];
    return options;
  }

  function buttons(extra) {
    var list = [{ extend: 'colvis', className: 'dt-btn' }];
    if (cfg.csv) list.push({ extend: 'csv', text: icons.download + ' CSV', className: 'dt-btn' });
    return list.concat(extra || []);
  }

  // Results/fixture tables: date-sorted on column 0 and paged to the nearest date.
  function resultsTable() {
    var table = $('#results-table').DataTable(controls({
      columnDefs: [{ type: 'date-euro', targets: 0 }],
      pageLength: 20,
      buttons: buttons()
    }));
    var today = new Date(cfg.nearestDate);
    var currentDateString = ('0' + today.getDate()).slice(-2) + '/'
      + ('0' + (today.getMonth() + 1)).slice(-2) + '/'
      + today.getFullYear();
    table.page.jumpToData(currentDateString, 0);
  }

  // Stats tables (player-stats, pair-stats, player-list, missed-three-list).
  function statsTable() {
    var table;
    var extra = [];

    if (cfg.columnSearch) {
      // Second header row of search boxes, one per column. Hidden by default; the
      // "Search columns" button reveals it.
      $('#results-table thead tr').clone(true).appendTo('#results-table thead');
      $('#results-table thead tr:eq(1)').addClass('dt-colsearch-row');
      $('#results-table thead tr:eq(1) th').each(function () {
        var title = $(this).text();
        $(this).html('<input type="text" placeholder="Search ' + title + '" />');
      });

      // Redrawing makes FixedHeader re-clone the header, which discards whatever has been
      // typed into these boxes since its last clone - searching on every keystroke dropped
      // roughly every other character. Debouncing means one redraw once typing stops, and
      // the handler is delegated so it survives the header being replaced.
      var searchTimers = {};
      $('#results-table thead').on('keyup change', '.dt-colsearch-row input', function () {
        var input = this;
        var i = $(input).closest('th').index();
        clearTimeout(searchTimers[i]);
        searchTimers[i] = setTimeout(function () {
          if (table.column(i).search() !== input.value) {
            table.column(i).search(input.value).draw();
          }
        }, 300);
      });

      extra.push({
        text: icons.search + ' Search columns',
        className: 'dt-btn dt-btn-colsearch',
        action: function (e, dt, node) {
          var on = $('#results-table').toggleClass('colsearch-on').hasClass('colsearch-on');
          $(node).toggleClass('active', on);
          // Never leave a per-column search applied while its box is hidden - the table
          // would look filtered for no visible reason.
          if (!on) {
            $('#results-table thead tr:eq(1) input').val('');
            dt.columns().search('').draw();
          }
          dt.columns.adjust();
          if (dt.fixedHeader) { dt.fixedHeader.adjust(); }
        }
      });
    }

    table = $('#results-table').DataTable(controls({
      orderCellsTop: true,
      fixedHeader: true,
      buttons: buttons(extra)
    }));
  }

  $(document).ready(cfg.kind === 'stats' ? statsTable : resultsTable);
})();
