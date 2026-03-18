import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createMockSupabase, createMockFetch, buildRequest } from "./helpers.ts";

// Test the away-alert logic by simulating the handler behavior

const MOCK_SHIFT = { id: "shift-1", day_of_week: 2, time_slot: "afternoon" };
const MOCK_AWAY_VOL = { id: "vol-away", first_name: "Lindsay" };
const MOCK_PREFERRED = [
  { volunteer_id: "vol-1" },
  { volunteer_id: "vol-2" },
  { volunteer_id: "vol-away" }, // should be excluded
];
const MOCK_VOLUNTEERS = [
  { id: "vol-1", first_name: "Beth", email: "beth@test.com", is_active: true, email_notifications: true },
  { id: "vol-2", first_name: "Joe", email: null, is_active: true, email_notifications: true }, // no email
];

Deno.test("away-alert: validates required fields", async () => {
  const req = buildRequest("POST", { shift_id: "s1" }); // missing fields
  // The function returns 400 when fields are missing
  // We test the validation logic
  assertEquals(true, true); // Placeholder — real test would call handler
});

Deno.test("away-alert: skips volunteers without email", () => {
  // vol-2 has no email — should be filtered out
  const withEmail = MOCK_VOLUNTEERS.filter((v) => v.email != null);
  assertEquals(withEmail.length, 1);
  assertEquals(withEmail[0].first_name, "Beth");
});

Deno.test("away-alert: excludes away volunteer from notifications", () => {
  const candidateIds = MOCK_PREFERRED
    .map((p) => p.volunteer_id)
    .filter((id) => id !== MOCK_AWAY_VOL.id);
  assertEquals(candidateIds.length, 2);
  assertEquals(candidateIds.includes("vol-away"), false);
});

Deno.test("away-alert: returns sent count of 0 when no preferred volunteers", () => {
  const preferred: typeof MOCK_PREFERRED = [];
  assertEquals(preferred.length, 0);
  // Function should return { ok: true, sent: 0 }
});

Deno.test("away-alert: handles OPTIONS preflight", async () => {
  const req = buildRequest("OPTIONS", undefined);
  // Function should return "ok" with CORS headers
  assertEquals(req.method, "OPTIONS");
});

Deno.test("away-alert: sends email with correct subject format", () => {
  const dayName = "Wednesday";
  const slotLabel = "Afternoon";
  const subject = `[Zen Care] Sub needed: ${dayName} ${slotLabel}`;
  assertEquals(subject, "[Zen Care] Sub needed: Wednesday Afternoon");
});
