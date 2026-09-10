// Turning a club's stored social handle into a profile URL.
//
// `club.facebook` / `.instagram` / `.twitter` are free-text admin fields
// (views/admin/club-form.ejs), and what is actually in them is a bare handle:
// `ghapbadminton`, `ManorBadminton`, `CollegeGreenBadmintonClub`, and one Facebook page
// id, `61576463475674`. Not one of the seven clubs that has a handle has stored a URL.
//
// Both consumers used to require `^https?://` and drop everything else — the visible
// links on `/clubs/:slug` and the schema.org `sameAs` in the JSON-LD. Correctly
// defensive, and completely vacuous: every club rendered no social links at all, and
// `sameAs` never carried a profile. Verified against production before changing it —
// /clubs/ghap and /clubs/manor contained no occurrence of their own handles.
//
// `sameAs` is the half that matters most. It is how a search engine connects a club page
// to that club's Facebook and Instagram, on pages that exist to answer "badminton club
// near me".
const BASES = {
  facebook: 'https://www.facebook.com/',
  instagram: 'https://www.instagram.com/',
  twitter: 'https://x.com/',
};

const LABELS = { facebook: 'Facebook', instagram: 'Instagram', twitter: 'X / Twitter' };

// A handle, not prose. Guessing a URL out of "ask us on facebook" would produce a
// confident link to a page that does not exist, which is worse than the empty section
// this replaces — so anything that is not handle-shaped returns null and is dropped.
const HANDLE = /^[A-Za-z0-9._-]+$/;

function socialUrl(platform, value) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return null;

  // Already a URL: pass it through untouched. Some clubs may yet store one, and
  // rewriting it would break a link that works.
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^www\./i.test(raw)) return 'https://' + raw;

  const base = BASES[platform];
  if (!base) return null;

  // A pasted "@handle" is the likeliest way an admin will type one.
  const handle = raw.replace(/^@+/, '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!HANDLE.test(handle)) return null;

  return base + handle;
}

// The links for one club, ready to render. Order is fixed so two pages cannot disagree.
function socialLinksFor(club) {
  if (!club) return [];
  return ['facebook', 'instagram', 'twitter']
    .map(platform => ({ platform, label: LABELS[platform], url: socialUrl(platform, club[platform]) }))
    .filter(link => link.url);
}

module.exports = { socialUrl, socialLinksFor };
