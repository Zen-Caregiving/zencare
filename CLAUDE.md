# Zencare Volunteer Shift Tracker

## Stack
- Vanilla JS SPA (no build tools)
- Supabase (PostgreSQL + Auth + RLS)
- GitHub Pages hosting

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
- Migration script: `scripts/import_spreadsheet.py`

## Deploy
```bash
git push origin main    # GitHub Pages auto-deploys
supabase db push        # Push schema to remote Supabase
```

## Architecture
- `index.html` - Single page with all HTML + CSS
- `js/app.js` - All client logic
- `js/config.js` - Supabase credentials (gitignored)
- No auth required for attendance entry (anon RLS)
- Admin features behind magic link auth
