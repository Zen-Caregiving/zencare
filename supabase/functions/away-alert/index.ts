import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const SLOT_LABELS: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { shift_id, shift_date, away_volunteer_id } = await req.json();

    if (!shift_id || !shift_date || !away_volunteer_id) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Get the shift details
    const { data: shift } = await supabase
      .from("shifts")
      .select("*")
      .eq("id", shift_id)
      .single();

    if (!shift) {
      return new Response(JSON.stringify({ error: "Shift not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get the away volunteer's name
    const { data: awayVol } = await supabase
      .from("volunteers")
      .select("first_name")
      .eq("id", away_volunteer_id)
      .single();

    // Find volunteers who prefer this day/slot
    const { data: preferred } = await supabase
      .from("preferred_shifts")
      .select("volunteer_id")
      .eq("day_of_week", shift.day_of_week)
      .eq("time_slot", shift.time_slot);

    if (!preferred || preferred.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const preferredIds = preferred.map((p) => p.volunteer_id);

    // Exclude the away volunteer
    const candidateIds = preferredIds.filter((id) => id !== away_volunteer_id);

    // Exclude volunteers already attending/assigned for this shift on this date
    const { data: existing } = await supabase
      .from("attendance")
      .select("volunteer_id")
      .eq("shift_id", shift_id)
      .eq("shift_date", shift_date)
      .neq("status", "away");

    const busyIds = new Set((existing || []).map((a) => a.volunteer_id));
    const finalIds = candidateIds.filter((id) => !busyIds.has(id));

    if (finalIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get emails for these volunteers
    const { data: volunteers } = await supabase
      .from("volunteers")
      .select("email, first_name")
      .in("id", finalIds)
      .eq("is_active", true)
      .eq("email_notifications", true)
      .not("email", "is", null);

    if (!volunteers || volunteers.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return new Response(JSON.stringify({ error: "Email not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dayName = DAY_NAMES[shift.day_of_week];
    const slotLabel = SLOT_LABELS[shift.time_slot];
    const awayName = awayVol?.first_name || "A volunteer";
    const appUrl = Deno.env.get("APP_URL") || "https://jhwright.github.io/zencare/";

    let sent = 0;
    for (const vol of volunteers) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: Deno.env.get("FROM_EMAIL") || "Zen Care <notifications@zencaregiving.org>",
          to: [vol.email],
          subject: `[Zen Care] Sub needed: ${dayName} ${slotLabel}`,
          text: `Hi ${vol.first_name},\n\n${awayName} is away for the ${dayName} ${slotLabel} shift on ${shift_date}.\n\nCan you sub? Open the app to sign up:\n${appUrl}\n\nThanks!\nZen Caregiving`,
        }),
      });

      if (res.ok) sent++;
    }

    return new Response(JSON.stringify({ ok: true, sent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
