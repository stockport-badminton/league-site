# Manchester vs Stockport league websites — what's different, and why the hosting costs what it does

*A plain-English write-up for the Manchester Badminton League (MCRBL), comparing its
website and hosting with the Stockport & Tameside league sites — and some practical
ways to bring the hosting bill down. Figures are typical-market estimates, labelled
as such; nobody's actual invoices were used.*

---

## The short version

Your site (**mcrbl.org.uk**) isn't the "spreadsheets-in-an-iframe" setup people
sometimes assume — it's a proper, custom-built **PHP + database** web application:
league tables, fixtures, results, player stats, a members area with logins, and
scorecard photo uploads. It's older-school in style, but it's a real app.

It lives on **Krystal**, a good-quality (but premium-priced) UK web host, on a
**"shared hosting"** plan. Shared hosting means you rent a slice of an always-on
server for a **fixed monthly fee whether anyone visits or not**. That's the main
reason the bill feels heavy — you're paying a flat premium rate around the clock for
a site that only gets busy on match nights.

The Stockport/Tameside sites are far more complicated under the bonnet, yet can cost
*less* to host — because they use a **"pay only when used"** cloud setup that's
effectively free when idle. The catch: that setup is spread across five specialist
services and takes real engineering to build and keep running.

**The single biggest saving for you is almost certainly the simplest one: you're
probably on a bigger/pricier plan than a quiet league site needs. Right-sizing the
plan, or moving to a cheaper cPanel host at renewal, could roughly halve (or better)
the bill with no change to the website itself.** More on that at the end.

---

## 1. What the Manchester site actually is (from inspecting it)

| Thing | What I found |
|---|---|
| **Type of site** | A custom-built web **application** (not a page-builder like Wix/Squarespace, and not Google Sheets) |
| **Language** | **PHP** — pages like `tables.php`, `fixtures.php`, `scorecards.php`, `clubs.php` |
| **Data store** | Almost certainly a **MySQL database** behind it (needed for the logins and scorecard entry) |
| **Look & feel** | **Bootstrap + jQuery** (common, older toolkit) with `TablePress`-style tables; tidy but dated |
| **Features** | League tables, fixtures, results/scorecards, player stats, clubs, tournaments (Slann Cup, Marjorie Consterdine), calendar, documents, history, photos |
| **Members area** | Register → get approved → log in → enter scorecards (with a **photo/scan upload**) |
| **Age** | Roughly **2011-era** (the contact address is `mbl2011site@gmail.com`), refined since |
| **Updated** | Partly **by hand** (pages carry "last updated" dates) |
| **Web server** | **LiteSpeed** |
| **Host** | **Krystal Hosting** — UK datacentre (London), cPanel, shared plan |

**In short:** it's a genuine, database-driven league site — much closer in ambition to
the Stockport site than a simple noticeboard page. It's just built with older tools
and updated more manually.

---

## 2. What each site *does* (functional differences)

Both sites cover the core league-secretary job. Stockport has simply had many more
features and automations bolted on over the years.

| Capability | Manchester (MCRBL) | Stockport / Tameside |
|---|---|---|
| League tables, fixtures, results | ✅ | ✅ |
| Player statistics | ✅ | ✅ **plus automatic ELO-style ratings** |
| Clubs / venues / contacts | ✅ | ✅ (with maps, admin screens) |
| Members / logins | ✅ | ✅ (via a dedicated login provider) |
| Scorecard entry | ✅ manual, with a **photo upload** | ✅ **reads the scorecard image automatically** |
| Tournaments / knockouts | ✅ (Slann Cup, Marjorie Consterdine) | ✅ (incl. a handicap "Messer" knockout) |
| Editing content | Mostly **hand-edited** | **Self-service admin panels** (no coder needed) |
| Social media | — | **Auto-generates result images + weekly videos** |
| Works offline / installs like an app | — | ✅ (a "progressive web app") |
| Email out to clubs | — | ✅ (mailing-list style distribution) |
| Cross-league scheduling tools | — | ✅ (e.g. a gap-finder across both leagues) |

**Take-away:** Manchester does the essentials well; Stockport adds a lot of
**automation** (less manual typing) and **integrations** (images, video, email,
offline). None of that is "better hosting" — it's more software.

---

## 3. Technical build — the real difference in effort

Think of it as **one tidy workshop** versus **a factory with many specialist
machines**.

**Manchester = one workshop.** Essentially *one* technology (PHP) talking to *one*
database (MySQL), on *one* host, edited through *one* control panel (cPanel). A
capable hobbyist can open a file, change it, and upload it. Few moving parts, easy for
one person to hold in their head — but changes are manual and the toolkit is dated.

**Stockport = a factory of specialist machines.** It's deliberately split across
several services that each do one job well:

- the **app** itself (Node.js) — runs the pages and logic
- a **database** (managed PostgreSQL) — stores the data
- **file storage** (Amazon S3) — holds scorecard images and generated media
- an **email service** (Amazon SES) — sends transactional emails
- a **login service** (Auth0) — handles sign-ins securely
- a **build-and-deploy pipeline** (Google Cloud Run + Cloud Build) — ships updates

Each piece is individually robust and scalable, but wiring six services together —
plus the build pipeline, database migrations, and security — takes genuine engineering
skill and ongoing maintenance. It's been "built up over time and constantly refined,"
which is exactly why it can do so much. **The cost of that power is complexity: it
needs a technical person to run.** Manchester's simpler build is a feature, not a
flaw — it's maintainable by one non-specialist.

---

## 4. Hosting, in plain English — and why the bills differ

This is the heart of it. There are two very different **models** for "where a website
lives," and they're billed completely differently.

### Model A — Shared hosting (what Manchester uses)

> **Analogy: renting a serviced flat in a shared building.**
> You rent a slice of a server that's **switched on 24/7**. The landlord (Krystal)
> maintains the building; you just put your files in via a control panel. You pay a
> **fixed monthly rent no matter how much you use it** — the meter runs the same on a
> dead Tuesday as on a busy match night.

- **Pros:** simple, predictable, no technical operations, one bill, friendly control
  panel, someone else patches the server.
- **Cons:** you pay a **flat fee even when idle**, and premium hosts charge premium
  rents. Krystal is a *good* host (UK-based, green, daily backups, real support) — but
  that quality comes at a **premium price**, and shared-host **renewal prices often
  jump** after the first term.
- **Typical price:** Krystal shared plans run about **£7/month for the entry plan up
  to ~£19/month** for larger tiers — i.e. roughly **£85–£230 a year**. If Manchester
  is on a mid/upper tier, or hit a renewal increase, that's very likely where the
  "heavy fees" are coming from.

### Model B — "Serverless" cloud (what Stockport uses)

> **Analogy: pay-as-you-go utilities from specialist suppliers.**
> The app is **asleep until someone visits**, then wakes for a moment and goes back to
> sleep ("scale to zero"). The database, storage and email are separate metered
> services, each with a generous **free allowance** that a league site rarely exceeds.

- **Pros:** can be **very cheap or effectively free** at this size — you're not paying
  for an idle server. Scales automatically if it ever gets busy.
- **Cons:** it's spread across **several accounts/services**, each needing setup and
  know-how; billing is usage-based (needs a little watching); **not** something a
  non-technical volunteer would want to assemble or maintain.
- **Typical price at league-site scale:** often **£0–£15/month**, frequently nearer
  the bottom thanks to free tiers.

### Why the simpler site can cost more

Manchester's site *looks* simpler but sits on the **"always-on, flat premium rent"**
model. Stockport's site is *far* more complex but sits on the **"pay only when used,
mostly free"** model. So the fee gap isn't about how fancy the website is — it's about
**which hosting model each one is on**. You're essentially paying premium rent for an
always-on server that your quiet league site barely uses.

---

## 5. How to bring the Manchester bill down (realistic options)

Ordered by **best effort-to-saving ratio for a non-technical maintainer**:

1. **Right-size the plan (biggest easy win, zero site changes).**
   A low-traffic league site does **not** need a mid or top shared-hosting tier. Log
   into the Krystal account and check which plan you're on and what it renews at. If
   it's above the entry tier, **downgrading** likely cuts the bill immediately with no
   change to the website. This is the first thing to check.

2. **Shop around at renewal / move to a cheaper cPanel host.**
   Shared hosts often lure you with a cheap first term, then renew higher. Comparable
   **cPanel + LiteSpeed** hosts start around **£2–£5/month (~£25–£60/year)**. Because
   your site is a standard PHP + MySQL + cPanel setup, moving it is a **well-trodden,
   low-risk job** — many hosts do the migration **for free**. This could realistically
   **halve or quarter** the bill. (Trade-off: budget hosts give less hand-holding than
   Krystal's UK support — worth weighing if you value that.)

3. **Don't chase "free" hosting — it won't fit as-is.**
   You'll see "free website hosting" (GitHub Pages, Netlify, Cloudflare Pages). Those
   only host **static** pages. Your **logins and scorecard uploads need PHP + a
   database**, so going fully static would **break those features** unless the site
   were rebuilt. Not worth it for the saving — avoid this rabbit hole.

4. **Trim stored scorecard photos if storage is pushing you up a tier.**
   Uploaded images pile up over seasons. If you're on a bigger plan mainly for disk
   space, **archiving or shrinking old scorecard images** could let you drop to a
   smaller plan.

5. **Check the domain isn't bundled at a premium.**
   Domain renewal (`mcrbl.org.uk`) is separate from hosting and is often marked up.
   A `.org.uk` should be only a few pounds a year — make sure you're not overpaying.

6. **Modernising the site is a project, not a quick saving.**
   Rebuilding onto a cheap cloud stack (like Stockport's) *could* get hosting near
   free — but it needs a **technical volunteer** and real time, and would change how
   the site is maintained. Keep it in mind as a "someday, if we find the right helper"
   option, not a fix for this year's bill.

**Bottom line:** you're not being ripped off — Krystal is a quality host — but you're
on a **premium, always-on** plan for a site that doesn't need one. Checking the plan
tier (step 1) and shopping the renewal (step 2) are the realistic, low-risk levers,
and between them they should meaningfully cut the fee without touching the website.

---

### Sources
- Krystal Hosting — plans & pricing: <https://krystal.io/hosting>
- Krystal Hosting review (pricing/tier context): <https://www.websiteplanet.com/web-hosting/krystal/>

*Prepared from a public inspection of mcrbl.org.uk (July 2026) and comparison with the
Stockport/Tameside stack. Cost figures are typical market estimates for illustration.*
