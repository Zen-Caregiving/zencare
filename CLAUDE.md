# Zencare Volunteer Shift Tracker

## Stack
- Vanilla JS SPA (no build tools)
- Supabase (PostgreSQL + Auth + RLS + Edge Functions + pg_cron)
- GitHub Pages hosting
- Resend for email notifications

## Local Development
```bash
supabase start          # Start local Supabase stack
supabase db reset       # Apply migrations + seed data
python3 -m http.server 3000  # Serve locally at http://127.0.0.1:3000
```

## Key Ports
- Supabase API: 54321
- PostgreSQL: 54322
- Studio: 54323 (http://127.0.0.1:54323)
- Inbucket: 54324 (http://127.0.0.1:54324)

## Database
- Schema: `sql/001_schema.sql`
- Seed data: `sql/002_seed_data.sql`
- Migrations: `supabase/migrations/`
- Migration script: `scripts/import_spreadsheet.py`

## Edge Functions
- `supabase/functions/update-email/` - Email verification flow (sends verification email)
- `supabase/functions/verify-email/` - Handles verification link clicks (returns HTML)
- `supabase/functions/away-alert/` - Emails preferred volunteers when someone marks away
- `supabase/functions/shift-reminder/` - Daily shift reminders (triggered by pg_cron)
- `supabase/functions/weekly-digest/` - Weekly schedule email (triggered by pg_cron)
- `supabase/functions/calendar-feed/` - Returns .ics calendar feed for subscription

## Testing
```bash
cd supabase/functions
deno test tests/    # Run all Edge Function tests
```

## Deploy

### First-time setup
1. Configure Supabase secrets:
   ```bash
   supabase secrets set RESEND_API_KEY=re_xxxx
   supabase secrets set FROM_EMAIL="Zen Care <notifications@zencaregiving.org>"
   supabase secrets set APP_URL="https://jhwright.github.io/zencare/"
   ```

2. Configure database settings (run in Supabase SQL editor):
   ```sql
   ALTER DATABASE postgres SET app.settings.supabase_url = 'https://mngcuykpdpvunenujdsa.supabase.co';
   ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
   ```
   Get the service role key from Supabase Dashboard > Settings > API.

### Deploying changes
```bash
# 1. Deploy Edge Functions first (so cron jobs have endpoints to call)
supabase functions deploy update-email
supabase functions deploy verify-email
supabase functions deploy away-alert
supabase functions deploy shift-reminder
supabase functions deploy weekly-digest
supabase functions deploy calendar-feed

# 2. Push database migrations
supabase db push

# 3. Push frontend (GitHub Pages auto-deploys)
git push origin main
```

### Post-deploy verification
1. Check cron jobs: Supabase Dashboard > Database > Extensions > pg_cron
2. Test email: mark a volunteer away, check Resend dashboard for delivery
3. Test calendar: open `https://mngcuykpdpvunenujdsa.supabase.co/functions/v1/calendar-feed` in browser
4. Verify PWA: load site on mobile, check "Add to Home Screen" works

## Architecture
- `index.html` - Single page with all HTML + CSS
- `js/app.js` - All client logic (schedule, attendance, admin, offline queue)
- `js/config.js` - Supabase credentials (public anon key, safe to commit for GitHub Pages)
- `sw.js` - Service worker for offline caching
- `manifest.json` - PWA manifest
- No auth required for attendance entry (anon RLS)
- Admin features behind magic link auth
- Email verification required for notification signups
