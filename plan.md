# Email Notifications Plan for Zencare

## Overview

Add email notifications for two events:
1. **Away alerts** — When a volunteer marks "away," email others who prefer that slot
2. **Shift reminders** — Email volunteers about their upcoming shifts

Email addresses collected via the existing `volunteers.email` column (already in schema, currently unpopulated).

---

## Phase 1: Email Collection UI

### 1.1 Add email input to My Shifts tab

In `index.html`, add an email field inside `#my-shifts-content`, below the volunteer selector and above the preferred shifts grid:

```html
<div id="email-section" style="display:none" class="mt-16 mb-16">
  <label class="text-sm text-muted">Email for shift notifications (optional)</label>
  <div style="display:flex; gap:8px; margin-top:4px">
    <input type="email" id="volunteer-email" placeholder="you@example.com" class="my-shifts-select" style="flex:1">
    <button class="btn btn-primary" id="save-email-btn">Save</button>
  </div>
  <p id="email-status" class="text-muted text-sm mt-8"></p>
</div>
```

### 1.2 Wire up email save in `app.js`

When a volunteer selects their name:
- Fetch their current email from `volunteersCache`
- Populate the input
- Show the section

On "Save" click:
- Update `volunteers.email` via Supabase
- Show confirmation text

**RLS change needed**: The `volunteers` table currently only allows authenticated users to update. Add an anon update policy restricted to the `email` column. OR: use an Edge Function to update the email (avoids opening up the volunteers table).

**Decision: Use an Edge Function** to update email. This avoids broadening RLS on the volunteers table and allows validation (e.g., format check, prevent overwriting another volunteer's email).

### 1.3 Create `supabase/functions/update-email/index.ts`

- Accepts `{ volunteer_id, email }`
- Validates email format
- Updates `volunteers.email` where `id = volunteer_id`
- Uses service_role key internally
- Callable with anon key (volunteers aren't authenticated)
- Basic abuse prevention: rate limit by IP or volunteer_id

---

## Phase 2: Away Alert Notifications

### 2.1 Create `supabase/functions/away-alert/index.ts`

Triggered from `app.js` when a volunteer marks "away."

**Input:** `{ shift_id, shift_date, away_volunteer_id }`

**Logic:**
1. Look up the shift (get `day_of_week`, `time_slot`)
2. Look up the away volunteer's name
3. Query `preferred_shifts` for volunteers who prefer that `day_of_week` + `time_slot`
4. Exclude the away volunteer themselves
5. Exclude volunteers already assigned/attending that shift on that date
6. Get email addresses for remaining volunteers (skip nulls)
7. Send email to each:
   - **Subject:** `[Zen Care] Sub needed: {Day} {Slot}`
   - **Body:** `{Name} is away for {Day} {Slot} on {Date}. Can you sub? Open the app to sign up: {app_url}`

**Email sending:** Use Supabase's built-in `net.http_post` to call Resend API (free tier: 100 emails/day, more than enough), or use Supabase's SMTP relay if configured.

### 2.2 Update `saveAttendance()` in `app.js`

After the existing upsert, if status is `'away'`:

```javascript
if (status === 'away') {
  fetch(`${SUPABASE_URL}/functions/v1/away-alert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({
      shift_id: shiftId,
      shift_date: shiftDate,
      away_volunteer_id: volunteerId
    })
  }).catch(console.error);
}
```

---

## Phase 3: Shift Reminder Notifications

### 3.1 Create `supabase/functions/shift-reminder/index.ts`

Invoked by pg_cron on a schedule.

**Logic:**
1. Determine today's day_of_week (0=Monday, 4=Friday)
2. If weekend, exit (shifts are weekdays only per schema constraint)
3. Query `shift_assignments` for today's shifts (join with volunteers for emails)
4. Check `attendance` for today — exclude anyone marked "away"
5. Send reminder email to each volunteer with an email:
   - **Subject:** `[Zen Care] Shift reminder: {Slot} today`
   - **Body:** `You're scheduled for the {slot} shift today. See the full schedule: {app_url}`

### 3.2 Create cron migration

`supabase/migrations/20260318000001_shift_reminders_cron.sql`

```sql
-- Send morning reminders at 7:30 AM, afternoon at 11:30 AM, evening at 3:30 PM
-- (Pacific time — adjust timezone as needed)
SELECT cron.schedule('morning-reminder', '30 14 * * 1-5',
  $$SELECT net.http_post(
    url := 'https://mngcuykpdpvunenujdsa.supabase.co/functions/v1/shift-reminder',
    body := '{"time_slot":"morning"}'::jsonb,
    headers := '{"Authorization":"Bearer SERVICE_ROLE_KEY","Content-Type":"application/json"}'::jsonb
  )$$
);

SELECT cron.schedule('afternoon-reminder', '30 18 * * 1-5',
  $$SELECT net.http_post(
    url := 'https://mngcuykpdpvunenujdsa.supabase.co/functions/v1/shift-reminder',
    body := '{"time_slot":"afternoon"}'::jsonb,
    headers := '{"Authorization":"Bearer SERVICE_ROLE_KEY","Content-Type":"application/json"}'::jsonb
  )$$
);

SELECT cron.schedule('evening-reminder', '30 22 * * 1-5',
  $$SELECT net.http_post(
    url := 'https://mngcuykpdpvunenujdsa.supabase.co/functions/v1/shift-reminder',
    body := '{"time_slot":"evening"}'::jsonb,
    headers := '{"Authorization":"Bearer SERVICE_ROLE_KEY","Content-Type":"application/json"}'::jsonb
  )$$
);
```

Note: Cron times are UTC. Adjust for the org's timezone.

---

## Phase 4: Email Provider Setup

### Option A: Resend (Recommended)

- Free tier: 100 emails/day, 3000/month
- Simple REST API, no SDK needed
- Store API key as Supabase secret: `supabase secrets set RESEND_API_KEY=...`
- Each Edge Function calls `https://api.resend.com/emails` directly

### Option B: Supabase SMTP + custom provider

- Configure SMTP in Supabase dashboard
- More setup, but uses Supabase's built-in email infrastructure

### Decision: Use Resend

Simpler, free, and the Edge Functions just do a `fetch()` to Resend's API.

---

## Phase 5: Notification Preferences (Optional Enhancement)

### 5.1 Add `email_notifications` boolean to volunteers table

Migration: `supabase/migrations/20260318000002_email_prefs.sql`

```sql
ALTER TABLE volunteers ADD COLUMN email_notifications BOOLEAN NOT NULL DEFAULT true;
```

### 5.2 Add toggle in My Shifts UI

A checkbox below the email input: "Send me shift notifications"

This lets volunteers opt out without removing their email (which may be used for other purposes like admin contact).

---

## Files to Create

| File | Purpose |
|------|---------|
| `supabase/functions/update-email/index.ts` | Save volunteer email securely |
| `supabase/functions/away-alert/index.ts` | Email preferred volunteers when someone is away |
| `supabase/functions/shift-reminder/index.ts` | Email daily shift reminders |
| `supabase/migrations/20260318000001_shift_reminders_cron.sql` | pg_cron schedule for reminders |

## Files to Modify

| File | Changes |
|------|---------|
| `index.html` | Add email input section in My Shifts tab |
| `js/app.js` | Email save logic, away-alert trigger in saveAttendance |
| `js/config.example.js` | Document any new config (none expected — RESEND key is server-side only) |
| `sql/001_schema.sql` | Add email_notifications column (keep in sync with migration) |

## What This Does NOT Include

- PWA / installability (separate effort, still recommended)
- Web Push notifications
- SMS
- Admin notification dashboard
- Email templates with HTML formatting (plain text is fine for v1)
- Delivery tracking / read receipts

---

## Security Considerations

1. **update-email function**: Rate limit to prevent spam. Validate email format server-side. The anon key is public, so anyone could call this — but the worst case is updating a volunteer's email, which is low-risk given the trust model.

2. **away-alert function**: Validate that the shift_id and volunteer_id exist. Add deduplication — don't send multiple away alerts for the same shift/date/volunteer combo (check attendance table for existing "away" record before sending).

3. **Resend API key**: Stored as a Supabase secret, never exposed to the client.

4. **Email addresses**: Stored in the existing `volunteers.email` column. Already has a UNIQUE constraint. Visible to anyone with DB read access (already the case via anon RLS on volunteers table — consider whether this is acceptable).

---

## Estimated Scope

- 3 Edge Functions (~50-80 lines each)
- 1 migration file
- ~30 lines added to index.html
- ~40 lines added to app.js
- No new dependencies, no build tools, no npm
