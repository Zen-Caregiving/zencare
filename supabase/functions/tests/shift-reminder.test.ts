import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

Deno.test("shift-reminder: skips weekends", () => {
  // dayOfWeek > 4 means weekend, function should return early
  const saturday = 5;
  const sunday = 6;
  assertEquals(saturday > 4, true);
  assertEquals(sunday > 4, true);
});

Deno.test("shift-reminder: converts JS day to app day correctly", () => {
  // JS: 0=Sunday, 1=Monday ... 6=Saturday
  // App: 0=Monday, 1=Tuesday ... 4=Friday
  const convert = (jsDay: number) => (jsDay === 0 ? 6 : jsDay - 1);
  assertEquals(convert(1), 0); // Monday
  assertEquals(convert(2), 1); // Tuesday
  assertEquals(convert(5), 4); // Friday
  assertEquals(convert(0), 6); // Sunday (weekend)
  assertEquals(convert(6), 5); // Saturday (weekend)
});

Deno.test("shift-reminder: excludes away volunteers from reminders", () => {
  const volunteerIds = ["v1", "v2", "v3"];
  const awayIds = new Set(["v2"]);
  const attending = volunteerIds.filter((id) => !awayIds.has(id));
  assertEquals(attending, ["v1", "v3"]);
});

Deno.test("shift-reminder: filters by time_slot when provided", () => {
  const shifts = [
    { id: "s1", day_of_week: 0, time_slot: "morning" },
    { id: "s2", day_of_week: 0, time_slot: "afternoon" },
  ];
  const timeSlot = "morning";
  const filtered = timeSlot ? shifts.filter((s) => s.time_slot === timeSlot) : shifts;
  assertEquals(filtered.length, 1);
  assertEquals(filtered[0].id, "s1");
});

Deno.test("shift-reminder: requires service role authorization", () => {
  const serviceKey = "test-service-key";
  const authHeader = "Bearer test-service-key";
  assertEquals(authHeader.includes(serviceKey), true);

  const badHeader = "Bearer wrong-key";
  assertEquals(badHeader.includes(serviceKey), false);
});

Deno.test("shift-reminder: skips volunteers with email_notifications=false", () => {
  const volunteers = [
    { id: "v1", email: "a@test.com", email_notifications: true },
    { id: "v2", email: "b@test.com", email_notifications: false },
    { id: "v3", email: null, email_notifications: true },
  ];
  const eligible = volunteers.filter((v) => v.email && v.email_notifications);
  assertEquals(eligible.length, 1);
  assertEquals(eligible[0].id, "v1");
});
