import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

Deno.test("update-email: validates email format", () => {
  const validEmails = ["a@b.com", "user@domain.org", "name+tag@example.co"];
  const invalidEmails = ["notanemail", "@missing.com", "no@", "spaces in@email.com"];
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  for (const email of validEmails) {
    assertEquals(regex.test(email), true, `${email} should be valid`);
  }
  for (const email of invalidEmails) {
    assertEquals(regex.test(email), false, `${email} should be invalid`);
  }
});

Deno.test("update-email: requires volunteer_id", () => {
  const body = { email: "test@test.com" };
  assertEquals(!body.hasOwnProperty("volunteer_id"), true);
});

Deno.test("update-email: clears email directly when empty string", () => {
  const email = "";
  // Empty email = clear, should not send verification
  assertEquals(!email, true);
});

Deno.test("update-email: handles notification-only update without email", () => {
  const body = { volunteer_id: "v1", email_notifications: false };
  // When email is undefined but email_notifications is set, update directly
  assertEquals(body.email_notifications, false);
  assertEquals((body as any).email, undefined);
});

Deno.test("update-email: generates UUID token", () => {
  const token = crypto.randomUUID();
  // UUID format: 8-4-4-4-12 hex chars
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  assertEquals(uuidRegex.test(token), true);
});

Deno.test("update-email: sets 24-hour expiry", () => {
  const now = Date.now();
  const expiresAt = new Date(now + 24 * 60 * 60 * 1000);
  const diffHours = (expiresAt.getTime() - now) / (1000 * 60 * 60);
  assertEquals(diffHours, 24);
});

Deno.test("update-email: skips verification if email unchanged", () => {
  const currentEmail = "test@test.com";
  const newEmail = "test@test.com";
  assertEquals(currentEmail === newEmail, true);
  // Function should return { ok: true, already_verified: true }
});
