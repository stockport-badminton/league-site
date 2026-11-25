// The event page's "Show map" (HARD-46), moved out of views/viewEventDetails.ejs
// (REARCH-07 step 5). The key, the venue's coordinates and its name are data attributes
// on #eventMap rather than written into the code.
(function () {
  var box = document.getElementById("eventMap");
  var button = document.getElementById("eventMapShow");
  if (!box || !button) return;

  // Google's bootstrap loader. It fetches nothing until importLibrary is first called.
  (g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=`https://maps.${c}apis.com/maps/api/js?`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({
    key: box.dataset.mapsKey,
    v: "weekly",
  });

  // Centred on the venue's stored coordinates, so no Places library or Place lookup.
  var venue = { lat: Number(box.dataset.lat), lng: Number(box.dataset.lng) };
  button.addEventListener("click", async function () {
    button.disabled = true;
    try {
      const { Map } = await google.maps.importLibrary("maps");
      const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
      box.textContent = "";
      const map = new Map(box, { center: venue, zoom: 15, mapId: "DEMO_MAP_ID" });
      new AdvancedMarkerElement({ position: venue, map: map, title: box.dataset.venue });
    } catch (err) {
      box.textContent = "The map could not be loaded. Use the Google Maps link above.";
    }
  });
})();
