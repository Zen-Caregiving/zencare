import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Calendar feed: returns .ics format for calendar subscription.
// GET /calendar-feed                  → all shifts for next 4 weeks
// GET /calendar-feed?volunteer_id=X   → only this volunteer's shifts
//
// Calendar apps (Apple Calendar, Google Calendar) poll this URL
// every 15-60 minutes for updates.

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const SLOT_LABELS: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

// Approximate shift times for calendar events (display only)
const SLOT_TIMES: Record<string, { start: string; end: string }> = {
  morning: { start: "09:00", end: "12:00" },
  afternoon: { start: "13:00", end: "16:00" },
  evening: { start: "17:00", end: "20:00" },
};

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const volunteerId = url.searchParams.get("volunteer_id");

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load shifts and assignments
    const { data: shifts } = await supabase.from("shifts").select("*");
    const { data: assignments } = await supabase
      .from("shift_assignments")
      .select("*, volunteers(first_name)")
      .eq("is_active", true);

    if (!shifts || !assignments) {
      return new Response("Internal error", { status: 500 });
    }

    // Filter to specific volunteer if requested
    const filteredAssignments = volunteerId
      ? assignments.filter((a) => a.volunteer_id === volunteerId)
      : assignments;

    // Generate events for next 4 weeks
    const now = new Date();
    const monday = getMonday(now);
    const events: string[] = [];

    for (let week = 0; week < 4; week++) {
      for (let d = 0; d < 5; d++) {
        const date = addDays(monday, week * 7 + d);
        const dateStr = formatDateICS(date);

        for (const assignment of filteredAssignments) {
          const shift = shifts.find((s) => s.id === assignment.shift_id);
          if (!shift || shift.day_of_week !== d) continue;

          const times = SLOT_TIMES[shift.time_slot];
          const volName = (assignment as any).volunteers?.first_name || "Volunteer";
          const summary = volunteerId
            ? `Zen Care: ${SLOT_LABELS[shift.time_slot]} Shift`
            : `Zen Care: ${volName} — ${SLOT_LABELS[shift.time_slot]}`;

          events.push(
            `BEGIN:VEVENT\r\n` +
              `DTSTART:${dateStr}T${times.start.replace(":", "")}00\r\n` +
              `DTEND:${dateStr}T${times.end.replace(":", "")}00\r\n` +
              `SUMMARY:${summary}\r\n` +
              `DESCRIPTION:${DAY_NAMES[d]} ${SLOT_LABELS[shift.time_slot]} shift at Zen Caregiving\r\n` +
              `UID:zencare-${shift.id}-${assignment.volunteer_id}-${dateStr}@zencaregiving.org\r\n` +
              `END:VEVENT`,
          );
        }
      }
    }

    const calendar =
      `BEGIN:VCALENDAR\r\n` +
      `VERSION:2.0\r\n` +
      `PRODID:-//Zen Caregiving//Shift Tracker//EN\r\n` +
      `CALSCALE:GREGORIAN\r\n` +
      `X-WR-CALNAME:Zen Care Shifts\r\n` +
      `${events.join("\r\n")}\r\n` +
      `END:VCALENDAR`;

    return new Response(calendar, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="zencare-shifts.ics"',
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return new Response("Internal error", { status: 500 });
  }
});

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDateICS(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}
