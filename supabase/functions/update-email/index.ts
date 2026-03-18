import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { volunteer_id, email, email_notifications } = await req.json();

    if (!volunteer_id) {
      return jsonResponse({ error: "volunteer_id required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Handle email_notifications toggle (no verification needed)
    if (email_notifications !== undefined && email === undefined) {
      const { error } = await supabase
        .from("volunteers")
        .update({ email_notifications })
        .eq("id", volunteer_id);
      if (error) return jsonResponse({ error: error.message }, 400);
      return jsonResponse({ ok: true });
    }

    // Handle email update — requires verification
    if (email !== undefined) {
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return jsonResponse({ error: "Invalid email format" }, 400);
      }

      // If clearing email, do it directly
      if (!email) {
        const update: Record<string, unknown> = {
          email: null,
          pending_email: null,
          email_token: null,
          token_expires_at: null,
        };
        if (email_notifications !== undefined) {
          update.email_notifications = email_notifications;
        }
        const { error } = await supabase
          .from("volunteers")
          .update(update)
          .eq("id", volunteer_id);
        if (error) return jsonResponse({ error: error.message }, 400);
        return jsonResponse({ ok: true });
      }

      // Check if this email is already verified for this volunteer
      const { data: vol } = await supabase
        .from("volunteers")
        .select("email")
        .eq("id", volunteer_id)
        .single();

      if (vol?.email === email) {
        // Email unchanged — just update notifications if needed
        if (email_notifications !== undefined) {
          await supabase
            .from("volunteers")
            .update({ email_notifications })
            .eq("id", volunteer_id);
        }
        return jsonResponse({ ok: true, already_verified: true });
      }

      // Generate verification token
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const update: Record<string, unknown> = {
        pending_email: email,
        email_token: token,
        token_expires_at: expiresAt,
      };
      if (email_notifications !== undefined) {
        update.email_notifications = email_notifications;
      }

      const { error } = await supabase
        .from("volunteers")
        .update(update)
        .eq("id", volunteer_id);

      if (error) return jsonResponse({ error: error.message }, 400);

      // Send verification email
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (!resendKey) {
        return jsonResponse({ error: "Email service not configured" }, 500);
      }

      const appUrl = Deno.env.get("APP_URL") || "https://jhwright.github.io/zencare/";
      const verifyUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/verify-email?token=${token}&volunteer_id=${volunteer_id}`;

      const from = Deno.env.get("FROM_EMAIL") || "Zen Care <notifications@zencaregiving.org>";
      const sent = await sendEmail({
        resendKey,
        from,
        to: email,
        subject: "[Zen Care] Verify your email",
        text: `Click the link below to verify your email for Zen Caregiving shift notifications:\n\n${verifyUrl}\n\nThis link expires in 24 hours.\n\nIf you didn't request this, you can ignore this email.`,
      });

      if (!sent) {
        return jsonResponse({ error: "Failed to send verification email" }, 500);
      }

      return jsonResponse({ ok: true, verification_sent: true });
    }

    return jsonResponse({ error: "No changes specified" }, 400);
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
