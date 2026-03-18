// Shared email utility with rate limiting and retry.
// Resend free tier: 2 emails/sec. We send at most ~1.5/sec with a 700ms gap.

const MIN_SEND_INTERVAL_MS = 700;
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [1000, 3000];

let lastSendTime = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SendEmailOptions {
  resendKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}

/**
 * Send a single email via Resend with rate limiting and retry on 429.
 * Returns true if the email was accepted.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<boolean> {
  // Rate limit: wait if we're sending too fast
  const now = Date.now();
  const elapsed = now - lastSendTime;
  if (elapsed < MIN_SEND_INTERVAL_MS) {
    await sleep(MIN_SEND_INTERVAL_MS - elapsed);
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    lastSendTime = Date.now();
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.resendKey}`,
      },
      body: JSON.stringify({
        from: opts.from,
        to: [opts.to],
        subject: opts.subject,
        text: opts.text,
      }),
    });

    if (res.ok) return true;

    if (res.status === 429 && attempt < MAX_RETRIES) {
      // Rate limited — back off and retry
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }

    // Non-retryable error or out of retries
    const body = await res.text().catch(() => "");
    console.error(`Email send failed (${res.status}): ${body}`);
    return false;
  }
  return false;
}

/**
 * Send multiple emails with built-in rate limiting.
 * Returns the count of successfully sent emails.
 */
export async function sendEmails(
  emails: Omit<SendEmailOptions, "resendKey" | "from">[],
  resendKey: string,
  from: string,
): Promise<number> {
  let sent = 0;
  for (const email of emails) {
    const ok = await sendEmail({ resendKey, from, to: email.to, subject: email.subject, text: email.text });
    if (ok) sent++;
  }
  return sent;
}
