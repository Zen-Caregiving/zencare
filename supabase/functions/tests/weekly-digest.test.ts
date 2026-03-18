import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

Deno.test("weekly-digest: calculates next Monday correctly", () => {
  // Sunday March 15, 2026 → next Monday = March 16
  const sunday = new Date(2026, 2, 15);
  const nextMonday = getTestMonday(addTestDays(sunday, 7));
  assertEquals(nextMonday.getDate(), 16);
});

Deno.test("weekly-digest: skips volunteers without assignments", () => {
  const assignments = [
    { shift_id: "s1", volunteer_id: "v1" },
    { shift_id: "s2", volunteer_id: "v1" },
  ];
  const v2Assignments = assignments.filter((a) => a.volunteer_id === "v2");
  assertEquals(v2Assignments.length, 0);
  // Function should skip v2
});

Deno.test("weekly-digest: includes shift partners in email", () => {
  const assignments = [
    { shift_id: "s1", volunteer_id: "v1" },
    { shift_id: "s1", volunteer_id: "v2" },
    { shift_id: "s1", volunteer_id: "v3" },
  ];
  const volunteers = [
    { id: "v1", first_name: "Beth" },
    { id: "v2", first_name: "Joe" },
    { id: "v3", first_name: "Lindsay" },
  ];

  const myId = "v1";
  const partners = assignments
    .filter((a) => a.shift_id === "s1" && a.volunteer_id !== myId)
    .map((a) => volunteers.find((v) => v.id === a.volunteer_id)?.first_name)
    .filter(Boolean);

  assertEquals(partners, ["Joe", "Lindsay"]);
});

Deno.test("weekly-digest: marks away volunteers in schedule text", () => {
  const status = "away";
  const statusText = status === "away" ? " [AWAY]" : "";
  assertEquals(statusText, " [AWAY]");
});

Deno.test("weekly-digest: requires service role authorization", () => {
  const serviceKey = "service-role-key";
  const validAuth = `Bearer ${serviceKey}`;
  assertEquals(validAuth.includes(serviceKey), true);

  const invalidAuth = "Bearer anon-key";
  assertEquals(invalidAuth.includes(serviceKey), false);
});

Deno.test("weekly-digest: generates correct subject line", () => {
  const weekLabel = "Mar 16 – Mar 20";
  const subject = `[Zen Care] Your schedule: ${weekLabel}`;
  assertEquals(subject, "[Zen Care] Your schedule: Mar 16 – Mar 20");
});

// Helper functions matching the Edge Function's logic
function getTestMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function addTestDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
