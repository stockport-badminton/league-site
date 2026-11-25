// The venue map on /info/clubs, moved out of views/club-v2.ejs (REARCH-07 step 5). Loaded
// after venue-popup.js. The venues are the page's #venue-data JSON block and the key is
// #map's data-maps-key. initMap stays a top-level function: Maps calls it by name
// (callback=initMap), and e2e/venue-map.spec.js checks it is defined.

var mapFallbackShown = false;

function showMapFallback() {
  if (mapFallbackShown) { return; }
  mapFallbackShown = true;
  var mapDiv = document.getElementById('map');
  var fallbackImg = document.getElementById('map-fallback');
  if (mapDiv) { mapDiv.style.display = 'none'; }
  if (fallbackImg) { fallbackImg.style.display = 'block'; }
}

function showLiveMap() {
  if (!mapFallbackShown) { return; }
  mapFallbackShown = false;
  var mapDiv = document.getElementById('map');
  var fallbackImg = document.getElementById('map-fallback');
  if (mapDiv) { mapDiv.style.display = ''; }
  if (fallbackImg) { fallbackImg.style.display = 'none'; }
}

// Google Maps JS API's documented callback for key/billing/auth
// rejection - the script can load fine (HTTP 200) while the key gets
// rejected afterwards, so a plain script onerror won't catch this case.
window.gm_authFailure = function() {
  showMapFallback();
};

// If initMap hasn't run a few seconds after the script load attempt,
// assume it's not coming (blocked/stalled network, silently-failing
// ad-blocker, etc.) and show the fallback.
var mapInitTimeout = setTimeout(showMapFallback, 4000);

// Initialize and add the map
function initMap() {
  clearTimeout(mapInitTimeout);

  // Stockport Town Hall, Edward Street (OpenStreetMap way 136354479). The rules define the
  // league's catchment as ten miles from here. The previous point was ~150m west, at
  // Stockport Exchange by the station.
  var StockportTownHall = {lat:53.4059929,lng:-2.1584417};
  var map = new google.maps.Map(
      document.getElementById('map'), {zoom: 10, center: StockportTownHall, mapId: '28eeb908f19e8aab',});

  // A constructed Map object doesn't guarantee tiles actually rendered - a
  // connection drop right after script load can leave a blank/grey div
  // even though this callback ran. Give tiles a few seconds to load.
  var tilesTimeout = setTimeout(showMapFallback, 3000);
  google.maps.event.addListenerOnce(map, 'tilesloaded', function() {
    clearTimeout(tilesTimeout);
    showLiveMap();
  });

  // `jsonForScript`, not `JSON.stringify`: a venue address is free text, and one
  // containing a closing script tag would otherwise end this block early — the browser
  // finds the end of a script element before any JS is parsed. See utils/jsonForScript.js.
  var data = JSON.parse(document.getElementById('venue-data').textContent);

  // ONE InfoWindow, reused. Google's own guidance, and the previous code created a new one
  // per marker — so clicking three pins left three popups open on top of each other.
  var infowindow = new google.maps.InfoWindow();

  data.forEach(function (venue) {
    // A venue with no coordinates cannot be placed.
    if (venue.Lat == null || venue.Lng == null) return;

    var clubMarker = new google.maps.marker.AdvancedMarkerElement({
      position: {lat: venue.Lat, lng: venue.Lng},
      map: map,
      gmpClickable: true
    });

    // AdvancedMarkerElement emits 'gmp-click', not 'click'; gmpClickable must be true for
    // it to fire at all.
    clubMarker.addListener('gmp-click', function () {
      // The pin's content comes from VenuePopup, which is where the escaping lives and
      // where the per-TEAM match nights are assembled. This block is only about Maps now.
      infowindow.setContent(VenuePopup.popupHtml(venue));
      infowindow.open(map, clubMarker);
    });
  })

  // The circle's centre, not a club. It used to be a default red pin with no click handler,
  // identical to every venue — PostHog recorded mobile rage clicks on it (13–14 Oct 2026)
  // from people expecting a club popup. So it looks different, and a tap explains it.
  var townHallPin = new google.maps.marker.PinElement({
    background: '#6c757d',
    borderColor: '#495057',
    glyphColor: '#ffffff',
    scale: 0.8
  });
  var markerStockPortTownHall = new google.maps.marker.AdvancedMarkerElement({
    position: StockportTownHall,
    map: map,
    content: townHallPin.element,
    title: 'Stockport Town Hall',
    gmpClickable: true
  });
  markerStockPortTownHall.addListener('gmp-click', function () {
    infowindow.setContent(
      '<strong>Stockport Town Hall</strong><br>' +
      'The league\'s catchment is ten miles from here &mdash; the shaded circle.'
    );
    infowindow.open(map, markerStockPortTownHall);
  });
  var circle = new google.maps.Circle({
  radius: 16093.44, // 10 miles in metres; Circle measures along the Earth's surface
  strokeColor: '#FF0000',
  strokeOpacity: 0.1,
  strokeWeight: 0.5,
  fillColor: '#0000ff',
  fillOpacity: 0.1,
  map,
  center:StockportTownHall})
}

// Added from script rather than as a tag, so a failed load can show the fallback without
// an inline onerror attribute (REARCH-07).
(function () {
  var maps = document.createElement('script');
  maps.src = '//maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(document.getElementById('map').dataset.mapsKey) + '&libraries=marker&callback=initMap&loading=async';
  maps.async = true;
  maps.onerror = showMapFallback;
  document.head.appendChild(maps);
})();
