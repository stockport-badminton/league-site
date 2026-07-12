/**
 * Venues map generator — builds a static fallback map image (Google Static
 * Maps API) plotting all club venues, shown when the live interactive map
 * (Google Maps JS API, on /info/clubs) can't load. Uploaded to S3 since
 * Cloud Run's container filesystem is ephemeral and not shared across
 * instances - a local-disk-written file would intermittently 404.
 *
 * Uses a separate, server-only API key (GMAPS_STATIC_API_KEY) restricted to
 * just the Static Maps API, not the client-exposed GMAPSAPIKEY.
 *
 * Usage:  node utils/venues-map-generator.js
 * Export: generateVenuesMap() → uploads to S3 and returns the object key
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const Venue = require('../models/venue');
const db = require('../db_connect');

const s3 = new S3Client({ region: 'eu-west-1' });
const S3_KEY = 'venues-map.png';

// Matches the live map's config (club-v2.ejs) for visual parity.
const CENTER = '53.4060787,-2.1606755'; // Stockport Town Hall
const ZOOM = 10;
const MAP_ID = '28eeb908f19e8aab';
const SIZE = '640x400';

function buildStaticMapUrl(venues) {
  const locations = venues
    .filter(function(v) { return v.Lat != null && v.Lng != null; })
    .map(function(v) { return v.Lat + ',' + v.Lng; });

  // No marker labels: Static Maps' label param takes one A-Z/0-9 character,
  // which can't uniquely label ~28 venues anyway - the live map doesn't
  // label its pins either (info windows on click only).
  const params = new URLSearchParams({
    center: CENTER,
    zoom: String(ZOOM),
    size: SIZE,
    map_id: MAP_ID,
    markers: 'color:red|' + locations.join('|'),
    key: process.env.GMAPS_STATIC_API_KEY
  });

  return 'https://maps.googleapis.com/maps/api/staticmap?' + params.toString();
}

async function generateVenuesMap() {
  const venues = await Venue.getVenueClubs();
  const url = buildStaticMapUrl(venues);

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error('Static Maps API returned ' + resp.status);
  }
  const buffer = Buffer.from(await resp.arrayBuffer());

  await s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: S3_KEY,
    Body: buffer,
    ContentType: 'image/png'
  }));

  console.log('[venues-map-generator] Uploaded ' + S3_KEY + ' (' + venues.length + ' venues, ' + buffer.length + ' bytes)');
  return S3_KEY;
}

module.exports = { generateVenuesMap, S3_KEY };

// CLI entry point - connect to the DB ourselves; when required as a module
// by the running app, app.js has already done this.
if (require.main === module) {
  db.connect();
  generateVenuesMap().catch(function(err) {
    console.error(err);
    process.exit(1);
  });
}
