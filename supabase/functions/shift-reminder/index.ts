import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmails } from "../_shared/email.ts";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const SLOT_LABELS: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

Deno.serve(async (req) => {
  // Only allow POST with service role key (called by cron)
  const authHeader = req.headers.get("Authorization");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!authHeader?.includes(serviceKey)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const timeSlot: string | undefined = body.time_slot;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceKey,
    );

    // Determine today's day_of_week (0=Monday, 4=Friday)
    const now = new Date();
    const jsDay = now.getDay(); // 0=Sunday
    const dayOfWeek = jsDay === 0 ? 6 : jsDay - 1; // Convert to 0=Monday

    // Only weekdays
    if (dayOfWeek > 4) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: "weekend" }));
    }

    const todayStr = now.toISOString().slice(0, 10);

    // Build shift query
    let shiftQuery = supabase
      .from("shifts")
      .select("*")
      .eq("day_of_week", dayOfWeek);

    if (timeSlot) {
      shiftQuery = shiftQuery.eq("time_slot", timeSlot);
    }

    const { data: shifts } = await shiftQuery;
    if (!shifts || shifts.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: "no shifts" }));
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return new Response(JSON.stringify({ error: "Email not configured" }), { status: 500 });
    }

    const appUrl = Deno.env.get("APP_URL") || "https://jhwright.github.io/zencare/";
    const from = Deno.env.get("FROM_EMAIL") || "Zen Care <notifications@zencaregiving.org>";
    const allEmails: { to: string; subject: string; text: string }[] = [];

    for (const shift of shifts) {
      // Get assigned volunteers
      const { data: assignments } = await supabase
        .from("shift_assignments")
        .select("volunteer_id")
        .eq("shift_id", shift.id)
        .eq("is_active", true);

      if (!assignments || assignments.length === 0) continue;

      const volunteerIds = assignments.map((a) => a.volunteer_id);

      // Check who is marked away
      const { data: awayRecords } = await supabase
        .from("attendance")
        .select("volunteer_id")
        .eq("shift_id", shift.id)
        .eq("shift_date", todayStr)
        .eq("status", "away");

      const awayIds = new Set((awayRecords || []).map((a) => a.volunteer_id));
      const attendingIds = volunteerIds.filter((id) => !awayIds.has(id));

      if (attendingIds.length === 0) continue;

      // Get volunteer emails
      const { data: volunteers } = await supabase
        .from("volunteers")
        .select("email, first_name")
        .in("id", attendingIds)
        .eq("is_active", true)
        .eq("email_notifications", true)
        .not("email", "is", null);

      if (!volunteers || volunteers.length === 0) continue;

      const dayName = DAY_NAMES[shift.day_of_week];
      const slotLabel = SLOT_LABELS[shift.time_slot];

      for (const vol of volunteers) {
        allEmails.push({
          to: vol.email!,
          subject: `[Zen Care] Shift reminder: ${slotLabel} today`,
          text: `Hi ${vol.first_name},\n\nThis is a reminder that you're scheduled for the ${dayName} ${slotLabel} shift today.\n\nSee the full schedule:\n${appUrl}\n\nThanks!\nZen Caregiving`,
        });
      }
    }

    const totalSent = await sendEmails(allEmails, resendKey, from);

    return new Response(JSON.stringify({ ok: true, sent: totalSent }));
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
});
