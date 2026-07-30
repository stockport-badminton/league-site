// JSON-LD construction for the pages search engines care about.
//
// This used to be literal JSON inside views/header.ejs, interpolated with `<%= %>`.
// Two classes of bug came from that and neither could fail loudly, because invalid
// JSON-LD is simply ignored — the page still renders, the markup just stops
// meaning anything:
//
//  1. **Invented property names.** `competitor: [{"@type":"SportsTeam",
//     "homeTeam":"Mellor A"}]` — SportsTeam has no `homeTeam` property, so the team
//     names were invisible. `location.address` was `{"type":"PostalAddress"}` with
//     no `@`, so the entire address was discarded. `Lat`/`Lng` aren't schema.org at
//     all; coordinates belong in `geo` as GeoCoordinates — and coordinates are
//     exactly what a "near me" query leans on.
//  2. **HTML escaping into JSON.** `<%= %>` escapes for HTML, not JSON, so a club
//     called Mulberry's shipped as `Mulberry&#39;s`, and a double quote in any name
//     would have broken the whole block. Building objects and running them through
//     JSON.stringify makes that structurally impossible.
//
// Everything here returns a plain object; `jsonLd()` serialises it for a <script>.
const { absoluteUrl, eventPath, clubPath, localYmd } = require('./canonical');

const LEAGUE_NAME = 'Stockport & District Badminton League';
const LOGO = '/static/beta/images/SDBLLogo.png';

// ---------------------------------------------------------------------------
// UK addresses
//
// `venue.address` is one freetext column, so the parts have to be recovered from
// it. The old markup did that with `String.match()` against a hardcoded list of
// town names and dropped the resulting *array* into the JSON, which is why
// `addressLocality` shipped as "Cheadle Hulme,Cheadle Hulme" and — for
// Tytherington School on Manchester Road, Macclesfield — "Manchester,Macclesfield".
//
// Taking the segment immediately before the postcode is simpler, needs no list to
// maintain, and is correct for all 19 clubs.
// ---------------------------------------------------------------------------
const POSTCODE = /\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*(\d[A-Z]{2})\b/i;

function parseUkAddress(freetext) {
  if (!freetext) return null;
  const s = String(freetext).trim();
  const m = s.match(POSTCODE);

  // Anything after the postcode is prose, not address — one venue carries three
  // sentences of parking directions that used to end up inside streetAddress.
  const head = (m ? s.slice(0, m.index) : s).replace(/[\s,.]+$/, '');
  const parts = head.split(',').map(p => p.trim()).filter(Boolean);

  const out = { '@type': 'PostalAddress' };
  if (parts.length > 1) {
    out.streetAddress = parts.slice(0, -1).join(', ');
    out.addressLocality = parts[parts.length - 1];
  } else if (parts.length === 1) {
    out.streetAddress = parts[0];
  }
  if (m) out.postalCode = (m[1] + ' ' + m[2]).toUpperCase();
  if (!out.streetAddress && !out.postalCode) return null;

  // addressRegion is deliberately absent. The old markup hardcoded "Cheshire" for
  // every club, including the M16/M20/M30 ones that are Greater Manchester. The
  // field is optional and a wrong value is worse than none.
  out.addressCountry = 'GB';
  return out;
}

// ---------------------------------------------------------------------------
// Coordinates
//
// Published behind a sanity check, because one venue is stored at latitude 54.4009
// — about 110km north of the league, in Cumbria — almost certainly a typo for
// 53.4009. Asserting a wrong location to a "near me" query is worse than
// asserting none, so anything outside the league's catchment is dropped.
// ---------------------------------------------------------------------------
const GEO_BOUNDS = { latMin: 52.9, latMax: 53.8, lngMin: -3.1, lngMax: -1.7 };

function geoOf(lat, lng) {
  const la = Number(lat), ln = Number(lng);
  if (!isFinite(la) || !isFinite(ln)) return null;
  if (la < GEO_BOUNDS.latMin || la > GEO_BOUNDS.latMax) return null;
  if (ln < GEO_BOUNDS.lngMin || ln > GEO_BOUNDS.lngMax) return null;
  return { '@type': 'GeoCoordinates', latitude: la, longitude: ln };
}

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------
const DAY_NAMES = {
  mon: 'Monday', monday: 'Monday',
  tue: 'Tuesday', tues: 'Tuesday', tuesday: 'Tuesday',
  wed: 'Wednesday', weds: 'Wednesday', wednesday: 'Wednesday',
  thu: 'Thursday', thur: 'Thursday', thurs: 'Thursday', thursday: 'Thursday',
  fri: 'Friday', friday: 'Friday',
  sat: 'Saturday', saturday: 'Saturday',
  sun: 'Sunday', sunday: 'Sunday',
};

// The UTC offset in force in London on a given calendar day, as "+01:00" or "Z".
//
// The old markup derived this from `getTimezoneOffset()` on the server, which is 0
// on Cloud Run — so the branch appending "+01:00" never ran in production and every
// startDate went out with no offset at all, leaving the time ambiguous. Asking Intl
// for London's offset gives the same answer wherever the process runs. Noon avoids
// the changeover hours.
function londonOffset(ymd) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', timeZoneName: 'longOffset',
  }).formatToParts(new Date(`${ymd}T12:00:00Z`));
  const name = (parts.find(p => p.type === 'timeZoneName') || {}).value || '';
  const m = name.match(/GMT([+-]\d{2}:\d{2})/);
  // Node reports winter as "GMT+00:00" rather than bare "GMT". Both mean UTC and
  // both are valid ISO 8601; normalise to Z, which is the conventional spelling.
  if (!m || m[1] === '+00:00' || m[1] === '-00:00') return 'Z';
  return m[1];
}

// "19:00" / "7.30pm" / "8 pm" -> "19:00". Null when there's no time in there.
function to24h(text) {
  if (!text) return null;
  const s = String(text).trim();
  // am/pm first: "7:30pm" also matches the bare 24-hour shape below, and taking
  // that branch would read it as 07:30 and silently drop twelve hours.
  let m = s.match(/(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)/i);
  if (!m) {
    // No meridiem, so treat a leading H:MM as already 24-hour (team.starttime).
    const h24 = s.match(/^(\d{1,2}):(\d{2})/);
    return h24 ? `${('0' + h24[1]).slice(-2)}:${h24[2]}` : null;
  }
  let h = parseInt(m[1], 10);
  const min = m[2] || '00';
  const pm = m[3].toLowerCase() === 'pm';
  if (pm && h < 12) h += 12;
  if (!pm && h === 12) h = 0;
  return `${('0' + h).slice(-2)}:${min}`;
}

// An ISO instant for a fixture, or a date-only string when there is no start time.
// schema.org accepts either; inventing a time would be worse than omitting one.
function eventDateTime(date, time) {
  const { y, m, d } = localYmd(date);
  const ymd = `${y}-${m}-${d}`;
  const hhmm = to24h(time);
  return hhmm ? `${ymd}T${hhmm}:00${londonOffset(ymd)}` : ymd;
}

// Club night -> OpeningHoursSpecification.
//
// `clubNight` holds a day abbreviation ("Tue", or "None"/null) and `clubNightText` a
// human string ("Tuesday 8pm", "Tues 8pm - 10pm Summer Club available..."). The day
// comes from whichever of the two yields one — Tatton has clubNight "None" but says
// "Sunday 7.30pm" in the text — and `closes` is emitted only when the text really
// does give a range.
function openingHours(clubNight, clubNightText) {
  let day = DAY_NAMES[String(clubNight || '').trim().toLowerCase()];
  if (!day && clubNightText) {
    const m = String(clubNightText).match(/\b(monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)\b/i);
    if (m) day = DAY_NAMES[m[1].toLowerCase()];
  }
  if (!day) return null;

  const times = String(clubNightText || '').match(/\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm)/gi) || [];
  const opens = to24h(times[0]);
  if (!opens) return null;

  const spec = {
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: 'https://schema.org/' + day,
    opens,
  };
  const closes = times.length > 1 ? to24h(times[1]) : null;
  if (closes) spec.closes = closes;
  return spec;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

function leagueOrganization() {
  return {
    '@type': 'SportsOrganization',
    name: LEAGUE_NAME,
    url: absoluteUrl('/'),
    sport: 'Badminton',
  };
}

// A fixture's /event/ page.
function sportsEvent(f) {
  const name = `${f.homeTeam} vs ${f.awayTeam}`;
  const teams = [f.homeTeam, f.awayTeam].map(n => ({ '@type': 'SportsTeam', name: n }));

  const place = { '@type': 'Place' };
  if (f.venueName) place.name = f.venueName;
  const address = parseUkAddress(f.venueAddress);
  if (address) place.address = address;
  const geo = geoOf(f.Lat, f.Lng);
  if (geo) place.geo = geo;
  if (f.venueLink) place.hasMap = f.venueLink;

  const out = {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name,
    url: absoluteUrl(eventPath(f)),
    startDate: eventDateTime(f.date, f.startTime),
    sport: 'Badminton',
    description: f.divisionName
      ? `${LEAGUE_NAME} ${f.divisionName} badminton match: ${name}.`
      : `${LEAGUE_NAME} badminton match: ${name}.`,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    isAccessibleForFree: true,
    image: [absoluteUrl(LOGO)],
    // The real properties for this, rather than a `competitor` entry with an
    // invented key. homeTeam/awayTeam are subproperties of competitor, so stating
    // them says everything the old markup meant to say, correctly.
    homeTeam: teams[0],
    awayTeam: teams[1],
    performer: teams,
    // The league runs the fixture. Both `performer` and `organizer` used to be set
    // to the home club.
    organizer: leagueOrganization(),
  };

  const end = f.endTime ? eventDateTime(f.date, f.endTime) : null;
  if (end && end !== out.startDate) out.endDate = end;
  if (Object.keys(place).length > 1) out.location = place;
  return out;
}

// A club on /info/clubs. SportsClub is a LocalBusiness subtype, so address, geo and
// openingHoursSpecification apply directly to it — which is what makes it the right
// type to answer "badminton clubs near me".
// Two callers pass two row shapes — /info/clubs regroups clubDetail() into
// `{venue, address}`, while getPublicClubs() selects `{venueName, venueAddress}` —
// so both spellings are accepted rather than making one caller reshape.
function sportsClub(c) {
  const venueName = c.venueName || c.venue;
  const venueAddress = c.venueAddress || c.address;

  const out = {
    '@context': 'https://schema.org',
    '@type': 'SportsClub',
    name: /badminton/i.test(c.name) ? c.name : `${c.name} Badminton Club`,
    sport: 'Badminton',
    // The club's own page on this site, not its external website — that goes in
    // sameAs. `url` pointing off-site claimed this markup described a page we do
    // not control.
    url: absoluteUrl(clubPath(c)),
    parentOrganization: leagueOrganization(),
  };

  const address = parseUkAddress(venueAddress);
  if (address) out.address = address;
  const geo = geoOf(c.Lat, c.Lng);
  if (geo) out.geo = geo;
  if (c.gMapUrl) out.hasMap = c.gMapUrl;
  if (venueName) {
    out.location = { '@type': 'Place', name: venueName };
    if (address) out.location.address = address;
    if (geo) out.location.geo = geo;
  }

  const sameAs = [c.clubWebsite, c.facebook, c.instagram, c.twitter]
    .map(u => (u == null ? '' : String(u).trim()))
    .filter(u => /^https?:\/\//i.test(u));
  if (sameAs.length) out.sameAs = sameAs;

  const hours = openingHours(c.clubNight, c.clubNightText);
  if (hours) out.openingHoursSpecification = [hours];

  const nightText = String(c.clubNightText || '').trim();
  if (nightText && !/^(none|na|n\/a)$/i.test(nightText)) {
    out.description = `Club night: ${nightText}.`;
  }
  return out;
}

// Trail for a page nested under a hub, e.g. Home > Clubs > Mellor Badminton Club.
// `crumbs` is [{name, path}] in order, innermost last.
function breadcrumbs(crumbs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map(function(c, i) {
      return {
        '@type': 'ListItem',
        position: i + 1,
        name: c.name,
        item: absoluteUrl(c.path),
      };
    }),
  };
}

// Sitewide identity, emitted once on the homepage. One @graph so the WebSite can
// reference the organisation by @id rather than repeating it.
function webSite() {
  const orgId = absoluteUrl('/') + '#organization';
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SportsOrganization',
        '@id': orgId,
        name: LEAGUE_NAME,
        url: absoluteUrl('/'),
        sport: 'Badminton',
        logo: absoluteUrl(LOGO),
        areaServed: {
          '@type': 'Place',
          name: 'Stockport and district, Greater Manchester and east Cheshire',
        },
      },
      {
        '@type': 'WebSite',
        '@id': absoluteUrl('/') + '#website',
        url: absoluteUrl('/'),
        name: LEAGUE_NAME,
        publisher: { '@id': orgId },
      },
    ],
  };
}

// Serialise for embedding in <script type="application/ld+json">.
//
// JSON.stringify handles quotes and apostrophes correctly (which HTML escaping did
// not); the only remaining hazard inside a script element is a literal `</script>`
// arriving in a name, so `<` is escaped. Keys assigned `undefined` are dropped by
// stringify, which is why the builders above can assign conditionally.
function jsonLd(obj) {
  return JSON.stringify(obj, null, 2).replace(/</g, '\\u003c');
}

module.exports = {
  parseUkAddress, geoOf, openingHours, to24h, londonOffset, eventDateTime,
  sportsEvent, sportsClub, leagueOrganization, webSite, breadcrumbs, jsonLd,
  LEAGUE_NAME, GEO_BOUNDS,
};
