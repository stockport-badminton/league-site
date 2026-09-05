-- What SES says happened to the mail we send.
--
-- On 27 Aug 2026 a distribution-list mail had all eleven of its gmail.com recipients
-- rejected -- Gmail rate-limited the sending domain, SES retried for 840 minutes and gave
-- up -- and eleven people never received a fixture withdrawal notice. It went unnoticed
-- for eight days, and the two places anyone would have looked both said nothing was wrong:
--
--   * `GetSendStatistics` reported 0 bounces, because the bounce was `Transient` and that
--     API counts only the bounces that damage your sending reputation.
--   * `/admin/audit` runs database checks, and this never touched the database.
--
-- The only record was an SNS notification in one inbox, among the delivery notifications
-- for every other message. So the events get stored, and the weekly digest gets a check
-- that reads them -- which is the same route every other silent failure in this codebase
-- was eventually caught by.
--
-- Written by POST /ses-events, from the `baddersEmail` configuration set's SNS topic.
-- One row per RECIPIENT per event: a bounce naming eleven addresses is eleven rows,
-- because the question is always "who did not get it".

CREATE TABLE IF NOT EXISTS email_event (
  id              SERIAL PRIMARY KEY,
  event_type      VARCHAR(32)  NOT NULL,   -- Bounce, Complaint, Delivery, DeliveryDelay, Reject, ...
  email           VARCHAR(320),            -- the recipient this row is about
  occurred_at     TIMESTAMP    NOT NULL,
  bounce_type     VARCHAR(32),             -- Permanent / Transient -- the distinction that hid this one
  bounce_subtype  VARCHAR(64),
  diagnostic_code TEXT,                    -- the receiving server's own words, which is where the answer is
  subject         TEXT,
  message_id      VARCHAR(128),
  created_at      TIMESTAMP    NOT NULL DEFAULT now()
);

-- SNS delivers at least once, so the same event can arrive twice. A message has one
-- outcome per recipient per event type, which makes this the natural key, and the writer
-- uses ON CONFLICT DO NOTHING against it.
CREATE UNIQUE INDEX IF NOT EXISTS email_event_natural
  ON email_event (message_id, email, event_type);

-- The check only ever asks about a recent window.
CREATE INDEX IF NOT EXISTS email_event_occurred
  ON email_event (occurred_at DESC);
