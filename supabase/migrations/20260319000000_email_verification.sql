-- Add email verification columns to volunteers table
-- pending_email: stores the email address awaiting verification
-- email_token: random token sent in verification link
-- token_expires_at: token expiry (24 hours from creation)
ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS pending_email TEXT;
ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS email_token TEXT;
ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;
