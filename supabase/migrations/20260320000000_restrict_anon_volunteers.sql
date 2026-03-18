-- Restrict anon SELECT on volunteers to non-sensitive columns only.
-- Email, phone, and pending_email are only readable by authenticated (admin).

-- Drop the permissive select-all policy
DROP POLICY IF EXISTS volunteers_select_all ON volunteers;

-- Authenticated users (admin) can read all columns
CREATE POLICY volunteers_select_authenticated ON volunteers
  FOR SELECT TO authenticated USING (true);

-- Anon can only read non-sensitive columns via column-level grants
REVOKE SELECT ON volunteers FROM anon;
GRANT SELECT (id, first_name, is_active, email_notifications, created_at, updated_at) ON volunteers TO anon;

-- Re-grant anon row-level access (RLS policy)
CREATE POLICY volunteers_select_anon ON volunteers
  FOR SELECT TO anon USING (true);
