import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmails } from "../_shared/email.ts";

// Weekly digest: sends one email per volunteer with the full week's schedule.
// Triggered by pg_cron on Sunday evening.

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const SLOT_LABELS: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

Deno.serve(async (req) => {
  // Only allow service role key (called by cron)
  const authHeader = req.headers.get("Authorization");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!authHeader?.includes(serviceKey)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceKey,
    );

    // Get next week's Monday
    const now = new Date();
    const nextMonday = getMonday(addDays(now, 7));

    // Load all data
    const { data: shifts } = await supabase.from("shifts").select("*");
    const { data: assignments } = await supabase
      .from("shift_assignments")
      .select("shift_id, volunteer_id")
      .eq("is_active", true);
    const { data: volunteers } = await supabase
      .from("volunteers")
      .select("id, first_name, email, email_notifications")
      .eq("is_active", true)
      .eq("email_notifications", true)
      .not("email", "is", null);

    if (!shifts || !assignments || !volunteers) {
      return new Response(JSON.stringify({ error: "Failed to load data" }), { status: 500 });
    }

    // Load next week's attendance (pre-marked away, etc.)
    const fridayStr = formatDate(addDays(nextMonday, 4));
    const mondayStr = formatDate(nextMonday);
    const { data: attendance } = await supabase
      .from("attendance")
      .select("*")
      .gte("shift_date", mondayStr)
      .lte("shift_date", fridayStr);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return new Response(JSON.stringify({ error: "Email not configured" }), { status: 500 });
    }

    const appUrl = Deno.env.get("APP_URL") || "https://jhwright.github.io/zencare/";
    const from = Deno.env.get("FROM_EMAIL") || "Zen Care <notifications@zencaregiving.org>";
    const allEmails: { to: string; subject: string; text: string }[] = [];

    for (const vol of volunteers) {
      // Build this volunteer's schedule for the week
      const myAssignments = assignments.filter((a) => a.volunteer_id === vol.id);
      if (myAssignments.length === 0) continue;

      let scheduleText = "";
      for (let d = 0; d < 5; d++) {
        const date = addDays(nextMonday, d);
        const dateStr = formatDate(date);
        const dayLines: string[] = [];

        for (const slot of ["morning", "afternoon", "evening"]) {
          const shift = shifts.find((s) => s.day_of_week === d && s.time_slot === slot);
          if (!shift) continue;

          const isAssigned = myAssignments.some((a) => a.shift_id === shift.id);
          if (!isAssigned) continue;

          // Check if marked away
          const att = (attendance || []).find(
            (a) => a.shift_id === shift.id && a.volunteer_id === vol.id && a.shift_date === dateStr,
          );
          const status = att?.status || "attending";

          // Get shift partners
          const partners = assignments
            .filter((a) => a.shift_id === shift.id && a.volunteer_id !== vol.id)
            .map((a) => volunteers.find((v) => v.id === a.volunteer_id)?.first_name || "?")
            .filter(Boolean);

          const partnerText = partners.length > 0 ? ` (with ${partners.join(", ")})` : "";
          const statusText = status === "away" ? " [AWAY]" : status === "late" ? " [LATE]" : "";

          dayLines.push(`  ${SLOT_LABELS[slot]}${statusText}${partnerText}`);
        }

        if (dayLines.length > 0) {
          scheduleText += `${DAY_NAMES[d]} ${formatDateShort(date)}:\n${dayLines.join("\n")}\n\n`;
        }
      }

      if (!scheduleText) continue;

      const weekLabel = `${formatDateShort(nextMonday)} – ${formatDateShort(addDays(nextMonday, 4))}`;

      allEmails.push({
        to: vol.email!,
        subject: `[Zen Care] Your schedule: ${weekLabel}`,
        text: `Hi ${vol.first_name},\n\nHere's your schedule for the week of ${weekLabel}:\n\n${scheduleText}View the full schedule: ${appUrl}\n\nThanks!\nZen Caregiving`,
      });
    }

    const totalSent = await sendEmails(allEmails, resendKey, from);

    return new Response(JSON.stringify({ ok: true, sent: totalSent }));
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
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

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateShort(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
