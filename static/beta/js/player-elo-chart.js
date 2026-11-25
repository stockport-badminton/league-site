// The player's rating chart, moved out of views/player-game-stats.ejs (REARCH-07 step 5).
// Its data is the page's #elo-data JSON block. The player's name used to be pasted into a
// JS string, so a name with an apostrophe stopped the chart drawing.
(function() {
  var data = JSON.parse(document.getElementById('elo-data').textContent);
  var allPoints = data.points;

  // One point per fixture date: keep the last game played that night so the
  // chart shows a clean "end-of-fixture rating" trend rather than per-game zigzags.
  var byDate = {};
  allPoints.forEach(function(pt) { byDate[pt.x] = pt; });
  var raw = Object.keys(byDate).sort().map(function(k) { return byDate[k]; });

  var points = data.strength;
  // No line or shading across a gap longer than a summer (2020/21 had no games).
  function hideLongGap(ctx) {
    return ctx.p1.parsed.x - ctx.p0.parsed.x > 200 * 86400000 ? 'transparent' : undefined;
  }

  new Chart(document.getElementById('elo-chart'), {
    type: 'line',
    data: {
      datasets: [{
        label: data.label,
        data: raw,
        borderColor: '#007bff',
        backgroundColor: 'rgba(0,123,255,0.08)',
        fill: true,
        tension: 0,
        pointRadius: 3,
        pointHoverRadius: 6
      }].concat(points.length ? [{
        // The band: the rating ± its standard error, shaded between two invisible lines.
        band: true,
        data: points.map(function(d){ return { x: d.x, y: d.y + d.se } }),
        borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, fill: false, tension: 0,
        segment: { backgroundColor: hideLongGap }
      }, {
        band: true,
        data: points.map(function(d){ return { x: d.x, y: d.y - d.se } }),
        borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, tension: 0,
        fill: '-1',
        backgroundColor: 'rgba(108,117,125,0.15)',
        segment: { backgroundColor: function(ctx) { return hideLongGap(ctx) || 'rgba(108,117,125,0.15)'; } }
      }, {
        label: 'Points rating',
        data: points,
        borderColor: '#6c757d',
        backgroundColor: '#6c757d',
        borderDash: [6, 4],
        // No line across a gap longer than a summer (2020/21 had no games).
        segment: { borderColor: hideLongGap },
        fill: false,
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 4
      }] : [])
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'time',
          time: { unit: 'month', tooltipFormat: 'dd MMM yyyy' },
          title: { display: false }
        },
        y: {
          title: { display: true, text: points.length ? 'Rating' : 'ELO Rating' }
        }
      },
      plugins: {
        legend: { display: points.length > 0, labels: { filter: function(item, data) { return !data.datasets[item.datasetIndex].band; } } },
        tooltip: {
          filter: function(item) { return !item.dataset.band; },
          callbacks: {
            label: function(ctx) {
              if (ctx.dataset.label === 'Points rating') return 'Points rating: ' + ctx.raw.y + ' (±' + ctx.raw.se + ')';
              return 'Rating: ' + ctx.raw.y + '  |  ' + ctx.raw.tip;
            }
          }
        }
      }
    }
  });
})();
