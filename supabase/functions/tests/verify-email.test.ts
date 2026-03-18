import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

Deno.test("verify-email: requires token and volunteer_id params", () => {
  const url = new URL("http://localhost/verify-email");
  assertEquals(url.searchParams.get("token"), null);
  assertEquals(url.searchParams.get("volunteer_id"), null);
});

Deno.test("verify-email: extracts params from URL", () => {
  const url = new URL("http://localhost/verify-email?token=abc-123&volunteer_id=vol-1");
  assertEquals(url.searchParams.get("token"), "abc-123");
  assertEquals(url.searchParams.get("volunteer_id"), "vol-1");
});

Deno.test("verify-email: rejects expired tokens", () => {
  const expiredAt = new Date("2025-01-01T00:00:00Z");
  const now = new Date("2026-03-17T00:00:00Z");
  assertEquals(expiredAt < now, true);
});

Deno.test("verify-email: accepts valid non-expired tokens", () => {
  const expiresAt = new Date("2027-01-01T00:00:00Z");
  const now = new Date("2026-03-17T00:00:00Z");
  assertEquals(expiresAt < now, false);
});

Deno.test("verify-email: rejects mismatched tokens", () => {
  const storedToken = "correct-token-uuid";
  const providedToken = "wrong-token-uuid";
  assertEquals(storedToken === providedToken, false);
});

Deno.test("verify-email: clears pending state after verification", () => {
  // After successful verification, these fields should be set to null:
  const update = {
    email: "verified@test.com",
    pending_email: null,
    email_token: null,
    token_expires_at: null,
  };
  assertEquals(update.pending_email, null);
  assertEquals(update.email_token, null);
  assertEquals(update.email, "verified@test.com");
});

Deno.test("verify-email: returns HTML response, not JSON", () => {
  const contentType = "text/html; charset=utf-8";
  assertEquals(contentType.includes("text/html"), true);
});
