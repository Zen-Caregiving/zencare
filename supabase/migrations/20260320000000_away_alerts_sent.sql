-- Track which away alerts have been sent to prevent duplicate emails
-- when a volunteer toggles away/back repeatedly.
CREATE TABLE IF NOT EXISTS away_alerts_sent (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shift_id bigint NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  shift_date date NOT NULL,
  away_volunteer_id bigint NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shift_id, shift_date, away_volunteer_id)
);

-- Allow service role full access (edge functions use service role key)
ALTER TABLE away_alerts_sent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON away_alerts_sent
  FOR ALL USING (true) WITH CHECK (true);

-- Clean up old records daily (keep 7 days)
SELECT cron.schedule(
  'cleanup-away-alerts-sent',
  '0 3 * * *',
  $$DELETE FROM away_alerts_sent WHERE sent_at < now() - interval '7 days'$$
);
