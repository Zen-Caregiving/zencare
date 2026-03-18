# Zen Caregiving — Volunteer Shift Tracker

A web app for [Zen Caregiving Project](https://zencaregiving.org) volunteers to coordinate daily shift attendance. Replaces a shared Google Sheet with a mobile-friendly interface that handles scheduling, attendance tracking, substitute coverage, and admin oversight.

## Features

- **Weekly schedule view** — Mon-Fri grid showing morning, afternoon, and evening shifts with color-coded attendance
- **Attendance entry** — Tap to mark attending, away, late, or partial; no login required
- **Substitute coverage** — Volunteers can flag "need a sub" or pick up open shifts
- **My Shifts** — Personal view with preferred shifts, upcoming schedule, and shift partners
- **Admin dashboard** — Magic link login for managing volunteers, shift assignments, and attendance trends
- **Email notifications** — Away alerts, daily reminders, and weekly digest via Resend
- **Calendar feed** — Subscribe to shifts via .ics URL
- **Offline support** — Attendance changes queue locally and sync when back online
- **PWA** — Installable on mobile with home screen icon

## Stack

- Vanilla JS SPA (no build tools, no framework)
- [Supabase](https://supabase.com) — PostgreSQL, Auth, Row Level Security, Edge Functions, pg_cron
- GitHub Pages hosting
- [Resend](https://resend.com) for transactional email

## Getting Started

```bash
# Prerequisites: supabase CLI, Python 3, Deno
supabase start
supabase db reset
python3 -m http.server 3000
```

Open http://127.0.0.1:3000

## Testing

```bash
cd supabase/functions
deno test tests/
```

## License

Private — Zen Caregiving Project
