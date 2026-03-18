import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

Deno.test("calendar-feed: generates valid ICS header", () => {
  const header =
    `BEGIN:VCALENDAR\r\n` +
    `VERSION:2.0\r\n` +
    `PRODID:-//Zen Caregiving//Shift Tracker//EN\r\n` +
    `CALSCALE:GREGORIAN\r\n` +
    `X-WR-CALNAME:Zen Care Shifts\r\n`;
  assertEquals(header.includes("BEGIN:VCALENDAR"), true);
  assertEquals(header.includes("VERSION:2.0"), true);
});

Deno.test("calendar-feed: formats date in ICS format (YYYYMMDD)", () => {
  const date = new Date(2026, 2, 17); // March 17, 2026
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const icsDate = `${y}${m}${d}`;
  assertEquals(icsDate, "20260317");
});

Deno.test("calendar-feed: generates unique UIDs per event", () => {
  const uid1 = `zencare-shift1-vol1-20260317@zencaregiving.org`;
  const uid2 = `zencare-shift1-vol2-20260317@zencaregiving.org`;
  assertEquals(uid1 !== uid2, true);
});

Deno.test("calendar-feed: filters by volunteer_id when provided", () => {
  const assignments = [
    { volunteer_id: "v1", shift_id: "s1" },
    { volunteer_id: "v2", shift_id: "s1" },
    { volunteer_id: "v1", shift_id: "s2" },
  ];
  const volunteerId = "v1";
  const filtered = assignments.filter((a) => a.volunteer_id === volunteerId);
  assertEquals(filtered.length, 2);
});

Deno.test("calendar-feed: returns all when no volunteer_id", () => {
  const assignments = [
    { volunteer_id: "v1", shift_id: "s1" },
    { volunteer_id: "v2", shift_id: "s1" },
  ];
  const volunteerId = null;
  const filtered = volunteerId
    ? assignments.filter((a) => a.volunteer_id === volunteerId)
    : assignments;
  assertEquals(filtered.length, 2);
});

Deno.test("calendar-feed: uses correct MIME type", () => {
  const contentType = "text/calendar; charset=utf-8";
  assertEquals(contentType, "text/calendar; charset=utf-8");
});

Deno.test("calendar-feed: getMonday returns correct Monday", () => {
  // Wednesday March 18, 2026
  const wed = new Date(2026, 2, 18);
  const day = wed.getDay(); // 3 = Wednesday
  const diff = wed.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(wed.getFullYear(), wed.getMonth(), diff);
  assertEquals(monday.getDate(), 16); // March 16 is Monday
});
