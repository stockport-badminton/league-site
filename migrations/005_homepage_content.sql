-- Content-managed homepage announcements + generic site settings.
-- Replaces the hand-edited News paragraph and BaxterModal.ejs/GeneraNoteModal.ejs
-- with admin-editable rows, and moves the Cloudinary gallery tag out of code.

CREATE TABLE homepage_announcement (
  id                 SERIAL PRIMARY KEY,
  title              TEXT NOT NULL,
  teaser_html        TEXT NOT NULL,
  modal_body_html     TEXT,
  image_url          TEXT,
  show_gallery_link  BOOLEAN NOT NULL DEFAULT false,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  active             BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE site_setting (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Preserve current behaviour: same Cloudinary tag the controller had hardcoded.
INSERT INTO site_setting (key, value) VALUES ('homepage_gallery_tag', 'messer2026');

-- Convert the current hardcoded homepage.ejs News copy into rows so the feed
-- isn't empty after this ships.
INSERT INTO homepage_announcement (title, teaser_html, modal_body_html, image_url, show_gallery_link, sort_order, active) VALUES
(
  'Baxter Trophy Champions!',
  'Congratulations to our Baxter Trophy team who retained their title this afternoon at Hazel Grove Sports Centre, beating teams from Crewe, Chester and Wirral leagues.<br /><br />Well played everyone! As winners we will be hosting again this time next year.<br />Photo L-R: Tom Huggon, Cat Golds, Chris Bellis, James Kee, Greg Mooney, Hannah Hernon, Rachel Flood, Anna Bellis',
  '<p>Photo L-R: Tom Huggon, Cat Golds, Chris Bellis, James Kee, Greg Mooney, Hannah Hernon, Rachel Flood, Anna Bellis</p>',
  'https://res.cloudinary.com/hvunsveuh/image/upload/ar_3:2,c_fill,f_auto/c_scale,w_auto:breakpoints_200_1920_30_5:300/2026/baxter-trophy-2026.jpg',
  false,
  1,
  true
),
(
  'Messer Trophy - Group Finals',
  'The Group Finals for the Messer Trophy have now been held. The Messer Group A Final was contested by 1st and 2nd in Division 1, Featherforce and David Lloyd. The match was very close with most of the level doubles being halved leaving the score at 6-6 going into the Mixed. In the mixed games which were also close Featherforce just edged all 3 to take the Trophy 9-6.<br /><br />The games in the Group B Final between Alderley Park C and College Green C were also close but Alderley Park C took the majority to win 10-5 overall.',
  NULL,
  NULL,
  false,
  2,
  true
),
(
  'Messer Trophy Final',
  'The Messer Trophy was won this year by Featherforce A who beat Alderley Park C 14-1.<br /> Due to the strength of the Featherforce team who are new to the league this year, they played in the final off a Premier rather than Division 1 handicap but they still proved too much for Alderley Park C with even the one game Alderley won being 21-20.<br /><br />Well done to both teams for playing the match in an excellent spirit and also to Featherforce A for their league and cup double!<br /><br />As always - questions / suggestions are always welcome - use the contact us menu to get in touch with me. Neil',
  NULL,
  NULL,
  true,
  3,
  true
),
(
  'Foundation Award Course',
  'We are running a Foundation Course in David Lloyd Cheshire Oaks, Stanney Lane CH5 9JN on the weekend of 5th and 6th April 2025.',
  '<p>The normal cost of these courses are £245 for non Badminton England members and £205 for Members. We will be running this for £170 due to Funding from local performance Centres in the Cheshire area. If you would like to book on please use <a href="https://badmintonengland.justgo.com/Workbench/i/r/public/EventsAndBookingsPublic/details/425F38000AF958647D5AF62AB9D91C1BB005A8DC/" target="_blank">this link</a> to book your place then pay a £50 Deposit to</p><p>Santander Business account<br />Its A Racket<br />40166411<br />09-06-66</p><p>Remainder of the cost will be paid on the day of the course depending on further funding if we can get some. You can see further details of the course <a href="https://badmintonengland.justgo.com/Workbench/i/r/public/EventsAndBookingsPublic/details/425F38000AF958647D5AF62AB9D91C1BB005A8DC/" target="_blank">here</a></p>',
  NULL,
  false,
  4,
  false
);

-- NOTE: 'Foundation Award Course' is seeded INACTIVE — it was never actually
-- linked from the homepage (GeneraNoteModal.ejs had no trigger anywhere) and
-- the course date (April 2025) has already passed. Kept for reference only;
-- delete or reactivate/edit via the new /admin/homepage-content UI as needed.
