-- Weekly digest email: send Sunday at 6:00 PM Pacific = Monday 01:00 UTC
-- Sends next week's schedule to all volunteers with email notifications enabled
SELECT cron.schedule(
  'weekly-digest',
  '0 1 * * 1',
  $$SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/weekly-digest',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    )
  )$$
);
