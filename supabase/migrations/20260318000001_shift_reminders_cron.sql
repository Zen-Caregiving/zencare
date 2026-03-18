-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Schedule shift reminder emails via pg_cron + pg_net
-- Times are UTC — adjust for your timezone (these assume US Pacific: UTC-7)
-- Morning reminder at 7:30 AM PT = 14:30 UTC
-- Afternoon reminder at 11:30 AM PT = 18:30 UTC
-- Evening reminder at 3:30 PM PT = 22:30 UTC

SELECT cron.schedule(
  'morning-shift-reminder',
  '30 14 * * 1-5',
  $$SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/shift-reminder',
    body := '{"time_slot":"morning"}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    )
  )$$
);

SELECT cron.schedule(
  'afternoon-shift-reminder',
  '30 18 * * 1-5',
  $$SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/shift-reminder',
    body := '{"time_slot":"afternoon"}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    )
  )$$
);

SELECT cron.schedule(
  'evening-shift-reminder',
  '30 22 * * 1-5',
  $$SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/shift-reminder',
    body := '{"time_slot":"evening"}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    )
  )$$
);
