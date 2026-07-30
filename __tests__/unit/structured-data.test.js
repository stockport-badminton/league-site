const SD = require('../../utils/structuredData');

// Every case below is real data from the club/venue tables. The old markup built
// this JSON as a template string, so none of it was reachable by a test; these are
// the specific outputs that were wrong in production.

describe('parseUkAddress', () => {
  it('takes the town from the segment before the postcode, not a name match', () => {
    // Was "Manchester,Macclesfield" — the old code regex-matched a hardcoded town
    // list against the whole string and hit "Manchester" inside "Manchester Road".
    const a = SD.parseUkAddress('Tytherington School, Manchester Road, Macclesfield, SK10 2EE');
    expect(a.addressLocality).toBe('Macclesfield');
    expect(a.streetAddress).toBe('Tytherington School, Manchester Road');
    expect(a.postalCode).toBe('SK10 2EE');
  });

  it('does not repeat the town', () => {
    // Was "Cheadle Hulme,Cheadle Hulme" — a match array joined into the JSON.
    const a = SD.parseUkAddress('Ladybridge Park Residents Club, Edenbridge Road, Cheadle Hulme, SK8 5PX');
    expect(a.addressLocality).toBe('Cheadle Hulme');
  });

  it('drops prose that follows the postcode', () => {
    const a = SD.parseUkAddress(
      'Everybody Sport and Recreation Fitness Centre, Alderley Park, Macclesfield, SK10 4TG. ' +
      'Please use South site entrance (just South of Alderley Edge bypass). NB this is a new ' +
      "building, NOT Mulberry's. Overflow carpark in front of Royal London building.");
    expect(a.addressLocality).toBe('Macclesfield');
    expect(a.postalCode).toBe('SK10 4TG');
    expect(a.streetAddress).not.toMatch(/Mulberry/);
    expect(a.streetAddress).toBe('Everybody Sport and Recreation Fitness Centre, Alderley Park');
  });

  it('handles a postcode with no comma before it', () => {
    const a = SD.parseUkAddress('Cheadle Hulme High School, Woods Ln, Cheadle Hulme, Cheadle SK8 7JY');
    expect(a.addressLocality).toBe('Cheadle');
    expect(a.postalCode).toBe('SK8 7JY');
  });

  it('always uses @type, never type', () => {
    // The old address object said "type": "PostalAddress", so the whole address was
    // ignored by every consumer.
    const a = SD.parseUkAddress('Lymm Leisure Centre, Oughtrington Ln, Lymm WA13 0RB');
    expect(a['@type']).toBe('PostalAddress');
    expect(a.type).toBeUndefined();
    expect(a.addressCountry).toBe('GB');
  });

  it('omits addressRegion rather than guessing it', () => {
    // Was hardcoded "Cheshire" for every club, including the Greater Manchester ones.
    const a = SD.parseUkAddress('Old Trafford Sports Barn, Seymour Park, Carver Street, Manchester, M16 9PQ');
    expect(a.addressRegion).toBeUndefined();
  });

  it('returns null for nothing usable', () => {
    expect(SD.parseUkAddress(null)).toBeNull();
    expect(SD.parseUkAddress('')).toBeNull();
  });
});

describe('geoOf', () => {
  it('emits GeoCoordinates, not Lat/Lng', () => {
    // "Lat"/"Lng" are not schema.org properties; coordinates were unreadable.
    const g = SD.geoOf(53.3935, -2.0397);
    expect(g).toEqual({ '@type': 'GeoCoordinates', latitude: 53.3935, longitude: -2.0397 });
  });

  it('drops coordinates outside the league catchment', () => {
    // One venue is stored at 54.4009 — ~110km north, in Cumbria. Publishing that to
    // a "near me" query is worse than publishing nothing.
    expect(SD.geoOf(54.4009, -2.1852)).toBeNull();
  });

  it('drops junk', () => {
    expect(SD.geoOf(null, null)).toBeNull();
    expect(SD.geoOf('', '')).toBeNull();
    expect(SD.geoOf('abc', 'def')).toBeNull();
  });
});

describe('to24h', () => {
  it.each([
    ['8pm', '20:00'],
    ['7.30pm', '19:30'],
    ['8 pm', '20:00'],
    ['7:30pm', '19:30'],
    ['12pm', '12:00'],
    ['12am', '00:00'],
    ['19:00', '19:00'],
  ])('%s -> %s', (input, expected) => {
    expect(SD.to24h(input)).toBe(expected);
  });

  it('returns null when there is no time', () => {
    expect(SD.to24h('NA')).toBeNull();
    expect(SD.to24h(null)).toBeNull();
  });
});

describe('londonOffset', () => {
  // The old template computed this from getTimezoneOffset() on the server, which is
  // 0 on Cloud Run, so production never appended an offset and every startDate was
  // ambiguous. This must not depend on the process timezone.
  it('is +01:00 during BST', () => {
    expect(SD.londonOffset('2026-09-03')).toBe('+01:00');
    expect(SD.londonOffset('2026-05-06')).toBe('+01:00');
  });

  it('is Z during GMT', () => {
    expect(SD.londonOffset('2027-01-13')).toBe('Z');
    expect(SD.londonOffset('2026-12-08')).toBe('Z');
  });
});

describe('eventDateTime', () => {
  it('carries the offset for the fixture date', () => {
    expect(SD.eventDateTime('2026-09-03T00:00:00', '19:00')).toBe('2026-09-03T19:00:00+01:00');
    expect(SD.eventDateTime('2027-01-13T00:00:00', '19:30')).toBe('2027-01-13T19:30:00Z');
  });

  it('falls back to a date when there is no start time', () => {
    expect(SD.eventDateTime('2026-09-03T00:00:00', null)).toBe('2026-09-03');
  });
});

describe('openingHours', () => {
  it('reads the day from the column and the time from the text', () => {
    expect(SD.openingHours('Tue', 'Tuesday 8pm')).toEqual({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: 'https://schema.org/Tuesday',
      opens: '20:00',
    });
  });

  it('emits closes only when the text gives a range', () => {
    const h = SD.openingHours('Tue', 'Tues 8pm - 10pm Summer Club available, please contact for details');
    expect(h.opens).toBe('20:00');
    expect(h.closes).toBe('22:00');
  });

  it('falls back to a day named in the text', () => {
    // Tatton: clubNight is "None" but the text says Sunday 7.30pm.
    const h = SD.openingHours('None', 'Sunday 7.30pm');
    expect(h.dayOfWeek).toBe('https://schema.org/Sunday');
    expect(h.opens).toBe('19:30');
  });

  it('survives a misspelled day when the column is right', () => {
    const h = SD.openingHours('Wed', 'Wedsnesday 6pm - 9pm');
    expect(h.dayOfWeek).toBe('https://schema.org/Wednesday');
    expect(h.opens).toBe('18:00');
    expect(h.closes).toBe('21:00');
  });

  it('returns null when there is genuinely no club night', () => {
    expect(SD.openingHours('None', 'NA')).toBeNull();
    expect(SD.openingHours(null, 'None')).toBeNull();
  });
});

describe('sportsEvent', () => {
  const fixture = {
    id: 7313,
    date: '2026-09-03T00:00:00',
    homeTeam: 'Mellor A',
    awayTeam: "Aerospace A",
    homeClub: 'Mellor',
    divisionName: 'Division 2',
    venueName: 'Mellor',
    venueAddress: 'Mellor Sports Club, 215 Longhust Lane, Mellor SK6 5PN',
    venueLink: 'https://goo.gl/maps/x',
    Lat: 53.3935,
    Lng: -2.0397,
    startTime: '19:00',
    endTime: '23:00',
  };

  it('names the teams in properties that exist', () => {
    // Was competitor:[{"@type":"SportsTeam","homeTeam":"Mellor A"}] — SportsTeam has
    // no homeTeam property, so the team names were invisible to consumers.
    const e = SD.sportsEvent(fixture);
    expect(e.homeTeam).toEqual({ '@type': 'SportsTeam', name: 'Mellor A' });
    expect(e.awayTeam).toEqual({ '@type': 'SportsTeam', name: 'Aerospace A' });
    expect(JSON.stringify(e)).not.toContain('"competitor"');
  });

  it('puts coordinates in geo and nothing in Lat/Lng', () => {
    const e = SD.sportsEvent(fixture);
    expect(e.location.geo.latitude).toBe(53.3935);
    expect(e.location.Lat).toBeUndefined();
    expect(e.location.Lng).toBeUndefined();
  });

  it('gives the address a real @type and parsed parts', () => {
    const e = SD.sportsEvent(fixture);
    expect(e.location.address['@type']).toBe('PostalAddress');
    expect(e.location.address.postalCode).toBe('SK6 5PN');
    expect(e.location.address.addressLocality).toBe('Mellor');
  });

  it('timestamps with an explicit offset', () => {
    const e = SD.sportsEvent(fixture);
    expect(e.startDate).toBe('2026-09-03T19:00:00+01:00');
    expect(e.endDate).toBe('2026-09-03T23:00:00+01:00');
  });

  it('uses https schema.org and a percent-encoded absolute url', () => {
    const e = SD.sportsEvent(fixture);
    expect(e['@context']).toBe('https://schema.org');
    expect(e.url).toBe('https://stockport-badminton.co.uk/event/7313/03092026-Mellor%20A-Aerospace%20A');
    expect(e.url).not.toContain(' ');
  });

  it('makes the league the organiser, not the home club', () => {
    const e = SD.sportsEvent(fixture);
    expect(e.organizer['@type']).toBe('SportsOrganization');
    expect(e.organizer.name).toBe('Stockport & District Badminton League');
  });

  it('omits location parts it cannot verify rather than emitting empties', () => {
    const e = SD.sportsEvent({ ...fixture, Lat: 54.4009, venueAddress: null });
    expect(e.location.geo).toBeUndefined();
    expect(e.location.address).toBeUndefined();
    expect(e.location.name).toBe('Mellor');
  });

  it('omits endDate when it would equal startDate', () => {
    const e = SD.sportsEvent({ ...fixture, startTime: null, endTime: null });
    expect(e.startDate).toBe('2026-09-03');
    expect(e.endDate).toBeUndefined();
  });
});

describe('sportsClub', () => {
  const club = {
    id: 43,
    name: 'Alderley Park',
    venue: 'Everybody Sport and Recreation',
    address: "Everybody Sport and Recreation Fitness Centre, Alderley Park, Macclesfield, SK10 4TG. NOT Mulberry's.",
    Lat: 53.2745,
    Lng: -2.2323,
    gMapUrl: 'https://maps.example/x',
    clubNight: 'Tue',
    clubNightText: 'Tues 8pm - 10pm',
    clubWebsite: 'https://alderleyparkbc.wixsite.com/alderleyparkbc',
  };

  it('points url at the club\'s own page and the club site at sameAs', () => {
    // `url` used to be the club's external website, claiming this markup described
    // a page we do not control. It briefly pointed at an anchor on /info/clubs;
    // now the clubs have real pages.
    const c = SD.sportsClub(club);
    expect(c.url).toBe('https://stockport-badminton.co.uk/clubs/alderley-park');
    expect(c.sameAs).toContain('https://alderleyparkbc.wixsite.com/alderleyparkbc');
  });

  it('accepts either row shape for the venue', () => {
    // /info/clubs regroups clubDetail() into {venue, address}; getPublicClubs()
    // selects {venueName, venueAddress}.
    const fromHub = SD.sportsClub(club);
    const fromPage = SD.sportsClub({
      ...club, venue: undefined, address: undefined,
      venueName: club.venue, venueAddress: club.address,
    });
    expect(fromPage.location.name).toBe(fromHub.location.name);
    expect(fromPage.address).toEqual(fromHub.address);
  });

  it('is a SportsClub with address, geo and opening hours', () => {
    const c = SD.sportsClub(club);
    expect(c['@type']).toBe('SportsClub');
    expect(c.address.postalCode).toBe('SK10 4TG');
    expect(c.geo['@type']).toBe('GeoCoordinates');
    expect(c.openingHoursSpecification[0].opens).toBe('20:00');
  });

  it('does not double up "Badminton Club" in the name', () => {
    expect(SD.sportsClub(club).name).toBe('Alderley Park Badminton Club');
    expect(SD.sportsClub({ ...club, name: 'Foo Badminton Club' }).name).toBe('Foo Badminton Club');
  });

  it('drops non-http sameAs values', () => {
    const c = SD.sportsClub({ ...club, clubWebsite: '', facebook: 'not a url', instagram: null });
    expect(c.sameAs).toBeUndefined();
  });
});

describe('jsonLd', () => {
  it('does not HTML-escape, so apostrophes and ampersands survive', () => {
    // `<%= %>` escaped for HTML, so a club called Mulberry's shipped as Mulberry&#39;s
    // and a double quote would have broken the JSON outright.
    const s = SD.jsonLd({ name: "Mulberry's & Sons", quote: 'a "quoted" thing' });
    expect(s).not.toContain('&#39;');
    expect(s).not.toContain('&amp;');
    expect(JSON.parse(s).name).toBe("Mulberry's & Sons");
    expect(JSON.parse(s).quote).toBe('a "quoted" thing');
  });

  it('escapes < so a name cannot close the script element', () => {
    const s = SD.jsonLd({ name: '</script><script>alert(1)</script>' });
    expect(s).not.toContain('</script>');
    expect(s).toContain('\\u003c');
    expect(JSON.parse(s).name).toBe('</script><script>alert(1)</script>');
  });

  it('produces parseable JSON for every real entity type', () => {
    expect(() => JSON.parse(SD.jsonLd(SD.webSite()))).not.toThrow();
    expect(() => JSON.parse(SD.jsonLd(SD.leagueOrganization()))).not.toThrow();
  });
});
