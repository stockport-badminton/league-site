-- Spam controls: blocklists that don't need a deploy, and a record of what was blocked.
--
-- Before this, blocking a spammer meant editing controllers/contactusController.js and
-- shipping: ~180 phrases and 89 email addresses were hardcoded there, and three IPs were
-- hardcoded in app.js. The 89 addresses are the evidence — someone has been hand-editing
-- source and deploying every time a new spammer turned up.

CREATE TABLE IF NOT EXISTS blocked_entry (
  id          SERIAL PRIMARY KEY,
  -- 'ip'     exact match on the resolved client address
  -- 'email'  exact match (case-insensitive) on a submitted email address
  -- 'phrase' case-insensitive substring of the message body
  -- 'word'   case-insensitive whole-word match in the message body
  kind        TEXT NOT NULL CHECK (kind IN ('ip', 'email', 'phrase', 'word')),
  value       TEXT NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  TEXT,
  -- Kept rather than deleted so an entry can be switched off without losing the note
  -- explaining why it was ever added.
  active      BOOLEAN NOT NULL DEFAULT TRUE
);

-- Case-insensitive uniqueness per kind: the same address added twice is a mistake, and
-- the admin screen should say so rather than silently duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS blocked_entry_kind_value_idx
  ON blocked_entry (kind, LOWER(value));

CREATE INDEX IF NOT EXISTS blocked_entry_active_idx
  ON blocked_entry (kind) WHERE active;

-- Every public submission and what happened to it.
--
-- There is currently no request logging of any kind, so nobody can answer "is this 3 a
-- week or 300?" — which also means there is no way to tell whether any of this work
-- helped. Deliberately narrow: enough to recognise a pattern and to justify adding a
-- blocklist entry, without keeping a copy of everything anyone ever typed.
CREATE TABLE IF NOT EXISTS submission_log (
  id            SERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  endpoint      TEXT NOT NULL,
  ip            TEXT,
  -- The raw X-Forwarded-For alongside the resolved address, because the resolved one is
  -- the leftmost entry and therefore client-settable — see utils/clientIp.js. Check this
  -- before blocking an address by hand.
  forwarded_for TEXT,
  user_agent    TEXT,
  -- 'accepted' | 'rejected'
  verdict       TEXT NOT NULL,
  -- Which check rejected it: 'captcha', 'honeypot', 'too-fast', 'blocked-email',
  -- 'blocked-phrase', 'blocked-word', 'validation', or NULL when accepted.
  reason        TEXT,
  email         TEXT,
  -- First 200 characters only. Enough to recognise a campaign, not a message archive.
  excerpt       TEXT
);

CREATE INDEX IF NOT EXISTS submission_log_created_idx ON submission_log (created_at DESC);
CREATE INDEX IF NOT EXISTS submission_log_verdict_idx ON submission_log (verdict, created_at DESC);

-- Seed the blocklist from what is currently hardcoded. Runs once, and ON CONFLICT DO NOTHING
-- makes re-running harmless.
--
-- Only the spam signals are seeded, not the profanity list. That list is politeness
-- policing rather than spam defence and it costs legitimate messages ("hell", "gay",
-- "sex", "ass" as whole words, and Gay is a real surname), so it is left behind deliberately.
-- The terms below are the ones actually catching spam.
INSERT INTO blocked_entry (kind, value, note, created_by) VALUES
  ('phrase', 'http://',                     'Link spam — the single most effective rule', 'migration 010'),
  ('phrase', 'https://',                    'Link spam', 'migration 010'),
  ('phrase', 'brokerage',                   'Finance spam', 'migration 010'),
  ('phrase', 'pharm',                       'Pharma spam', 'migration 010'),
  ('phrase', 'blockchain',                  'Crypto spam', 'migration 010'),
  ('phrase', 'cryptocurrency',              'Crypto spam', 'migration 010'),
  ('phrase', '@Cryptaxbot',                 'Crypto spam', 'migration 010'),
  ('phrase', 'forex',                       'Finance spam', 'migration 010'),
  ('phrase', 'adultdating',                 'Adult spam', 'migration 010'),
  ('phrase', 'xrated',                      'Adult spam', 'migration 010'),
  ('phrase', '000***',                      'Seen in finance spam', 'migration 010'),
  ('phrase', '@FeedbackMessages',           'Bot signature', 'migration 010'),
  ('phrase', 'messages exploitation',       'Bot signature', 'migration 010'),
  ('phrase', 'Financial Strategic Firm',    'Finance spam', 'migration 010'),
  ('phrase', 'Business Financial Team',     'Finance spam', 'migration 010'),
  ('phrase', 'wininphone',                  'Bot signature', 'migration 010'),
  ('phrase', 'corta.co',                    'Spam domain', 'migration 010')
ON CONFLICT (kind, LOWER(value)) DO NOTHING;

INSERT INTO blocked_entry (kind, value, note, created_by) VALUES
  ('ip', '136.243.212.110', 'Hardcoded in app.js before this table existed', 'migration 010'),
  ('ip', '165.231.182.103', 'Hardcoded in app.js before this table existed', 'migration 010'),
  ('ip', '65.0.96.6',       'Hardcoded in app.js before this table existed', 'migration 010')
ON CONFLICT (kind, LOWER(value)) DO NOTHING;

-- The 89 spammer addresses that were hardcoded in containsDodgyEmail. Each one of these
-- represents somebody editing source and running a deploy to block one sender, which is
-- the treadmill this table exists to end.
INSERT INTO blocked_entry (kind, value, note, created_by) VALUES
  ('email', '333dino88@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', '5rdhp2fe29yb@beconfidential.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'aferinohis056@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'ahmed.abdulla00175@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'ameyjeffrey@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'anepivepaz038@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'arachnid@notdot.net', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'arikerer278@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'artweb.agency@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'axobajigufo34@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'bahmmbi3@aghemfondom.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'bassproshops28@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'bfifield@yahoo.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'boboyobe@yahoo.com.hk', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'breiner@cljfarmaceutisch.nl', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'bsara5865@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'carlosc@optonline.net', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'chris@schoolconnection.co.uk', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'cikoliag@yandex.ru', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'derylcvnq@hotmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'dinanikolskaya99@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'drbreiner233@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'duqotayowud23@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'ebojajuje04@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'elviemcxa@yahoo.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'ericpetersonpa@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'evalidator.test@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'floodservice.bot@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'help@aweb.sbs', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'hrhbah-mbi@aghemfondom.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'hrhmbambi@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'htbabd@yahoo.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'hymen8ojw@yahoo.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'irinademenkova86@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'ixutikob077@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'j.anderson51@outlook.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'jalenb8dd@aol.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'jamescook312@outlook.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'jaronni9o@zohomail.eu', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'jhuball@sbcglobal.net', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'june_mandap@yahoo.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'kaenquirynicholls@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'kayleighbpsteamship@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'lucido.leinteract@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'lyraedwards@msn.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'm5062n@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'mark@mtbgreentechnologies.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'meifan36@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'miklom1012@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'moot888@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'moqagides18@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'mr.bumbaster81@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'n-dixie@hotmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'nhu-tran@sac-city.k12.ca.us', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'nikitafofanov46@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'nomin.momin+229a5@mail.ru', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'normandmercier@sbcglobal.net', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'ocopesuq299@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'oknabalkonekb@rambler.ru', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'olivier@balzcavocte.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'oscar7ctj@mail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'parmazanov@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'peichun22@yahoo.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'projectdept@kanzalshamsprojectmgt.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'projectoffice111@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'rayanwmlp@zohomail.eu', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'rescueplumbhifi@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'rhickey@gvtc.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'saniaftab464@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'schuhmann5586@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'simpsonmiddleton1111@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'simpsonmiddleton@bankingandfinanceconsultantsltd.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'smithduncan610@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'steven.green@m-solv.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'stevenlove88@163.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'susan@wikiexpertiinc.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'tbartol54@yahoo.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'test@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'testflood1488@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'w.wojcik1000@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'williamgrebos605@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'wilmafoxchildren@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'winsatall4ever@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'xiceruxuk02@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'xingsong@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'yawiviseya67@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'yjdisantoyjdissemin@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'yourmail@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010'),
  ('email', 'zekisuquc419@gmail.com', 'Seeded from the hardcoded list in contactusController.js', 'migration 010')
ON CONFLICT (kind, LOWER(value)) DO NOTHING;
