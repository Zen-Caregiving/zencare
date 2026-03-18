-- Zencare Volunteer Shift Tracker Schema
-- 5 tables: volunteers, shifts, shift_assignments, preferred_shifts, attendance

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE volunteers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  email_notifications BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 4),
  time_slot TEXT NOT NULL CHECK (time_slot IN ('morning', 'afternoon', 'evening')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(day_of_week, time_slot)
);

CREATE TABLE shift_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  volunteer_id UUID NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shift_id, volunteer_id)
);

CREATE TABLE preferred_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  volunteer_id UUID NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 4),
  time_slot TEXT NOT NULL CHECK (time_slot IN ('morning', 'afternoon', 'evening')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(volunteer_id, day_of_week, time_slot)
);

CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES shifts(id),
  volunteer_id UUID NOT NULL REFERENCES volunteers(id),
  shift_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('attending', 'away', 'late', 'partial')),
  sub_for_id UUID REFERENCES volunteers(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shift_id, volunteer_id, shift_date)
);

-- ============================================================
-- TRIGGERS
-- ============================================================

CREATE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_volunteers_updated_at
  BEFORE UPDATE ON volunteers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_attendance_updated_at
  BEFORE UPDATE ON attendance
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_shift_assignments_shift_id ON shift_assignments(shift_id);
CREATE INDEX idx_shift_assignments_volunteer_id ON shift_assignments(volunteer_id);
CREATE INDEX idx_preferred_shifts_volunteer_id ON preferred_shifts(volunteer_id);
CREATE INDEX idx_attendance_shift_id ON attendance(shift_id);
CREATE INDEX idx_attendance_volunteer_id ON attendance(volunteer_id);
CREATE INDEX idx_attendance_shift_date ON attendance(shift_date);
CREATE INDEX idx_volunteers_is_active ON volunteers(is_active);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE volunteers ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE preferred_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

-- Shifts: everyone can read
CREATE POLICY shifts_select_all ON shifts FOR SELECT TO anon, authenticated USING (true);

-- Volunteers: everyone can read, authenticated can modify
CREATE POLICY volunteers_select_all ON volunteers FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY volunteers_insert_auth ON volunteers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY volunteers_update_auth ON volunteers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY volunteers_delete_auth ON volunteers FOR DELETE TO authenticated USING (true);

-- Shift assignments: everyone can read, authenticated can modify
CREATE POLICY shift_assignments_select_all ON shift_assignments FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY shift_assignments_insert_auth ON shift_assignments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY shift_assignments_update_auth ON shift_assignments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY shift_assignments_delete_auth ON shift_assignments FOR DELETE TO authenticated USING (true);

-- Preferred shifts: everyone can read/insert/update (self-managed, no login needed)
CREATE POLICY preferred_shifts_select_all ON preferred_shifts FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY preferred_shifts_insert_all ON preferred_shifts FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY preferred_shifts_update_all ON preferred_shifts FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY preferred_shifts_delete_auth ON preferred_shifts FOR DELETE TO authenticated USING (true);

-- Attendance: everyone can read/insert/update (no login needed for basic use)
CREATE POLICY attendance_select_all ON attendance FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY attendance_insert_all ON attendance FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY attendance_update_all ON attendance FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY attendance_delete_auth ON attendance FOR DELETE TO authenticated USING (true);
