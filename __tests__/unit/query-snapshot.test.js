// tools/query-snapshot.js is how REARCH-01 and REARCH-02 prove a query rewrite inert, so a
// diff that misses a difference turns "proved" into "asserted". The database half was
// demonstrated by hand (REARCH-08, Part 1); this pins the parts that need none: which hosts
// it will touch, and what it calls a difference.
const { localReadOnlyUrl, normalise, diff } = require('../../tools/query-snapshot');

describe('query-snapshot: which database', () => {
  it('refuses a Supabase host', () => {
    expect(() => localReadOnlyUrl('postgresql://u:p@aws-0-eu-west-2.pooler.supabase.com:5432/postgres'))
      .toThrow(/local database only/);
  });

  it('refuses any host that is not this machine', () => {
    expect(() => localReadOnlyUrl('postgresql://u:p@db.example.com:5432/x')).toThrow(/local database only/);
  });

  it('opens a loopback database read-only', () => {
    const url = new URL(localReadOnlyUrl('postgresql://sdbl:sdbl@127.0.0.1:5433/sdbl'));
    expect(url.searchParams.get('options')).toBe('-c default_transaction_read_only=on');
  });
});

describe('query-snapshot: what counts as a difference', () => {
  const rows = (...r) => normalise(r);

  it('a folded alias is reported once per shape, both spellings named', () => {
    const before = rows({ venueId: 1, name: 'a' }, { venueId: 2, name: 'b' });
    const after = rows({ venueid: 1, name: 'a' }, { venueid: 2, name: 'b' });
    expect(diff(before, after, {})).toEqual([
      '[] (2 objects): keys only before: venueId',
      '[] (2 objects): keys only after:  venueid',
    ]);
  });

  it('a changed value is reported with its path', () => {
    expect(diff(rows({ n: 1 }), rows({ n: 2 }), {})).toEqual(['[0].n: 1 → 2']);
  });

  it('row order is a difference unless --unordered', () => {
    const a = rows({ n: 1 }, { n: 2 }), b = rows({ n: 2 }, { n: 1 });
    expect(diff(a, b, {})).toEqual(['(result): same 2 rows, different order']);
    expect(diff(a, b, { unordered: true })).toEqual([]);
  });

  it('key ORDER is not a difference; a consumer reads by name', () => {
    expect(diff(rows({ a: 1, b: 2 }), rows({ b: 2, a: 1 }), {})).toEqual([]);
  });

  it('a Date and its ISO string are not the same answer', () => {
    const d = new Date('2026-10-25T00:00:00Z');
    expect(diff(rows({ d }), rows({ d: d.toISOString() }), {})).not.toEqual([]);
  });

  it('a missing row count is reported', () => {
    expect(diff(rows({ n: 1 }), rows(), {})).toEqual(['(result): 1 rows before, 0 after']);
  });
});
