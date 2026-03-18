-- Add email_notifications preference column to volunteers
ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN NOT NULL DEFAULT true;
