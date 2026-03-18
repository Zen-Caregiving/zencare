import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Verify-email: handles GET requests from verification links in emails.
// Validates the token, updates the volunteer's email, clears pending state.
// Returns an HTML page (not JSON) since users click this in their browser.

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const volunteerId = url.searchParams.get("volunteer_id");

  if (!token || !volunteerId) {
    return htmlResponse("Missing verification parameters.", false);
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Look up the volunteer with matching token
    const { data: vol, error: fetchError } = await supabase
      .from("volunteers")
      .select("id, email_token, pending_email, token_expires_at")
      .eq("id", volunteerId)
      .single();

    if (fetchError || !vol) {
      return htmlResponse("Volunteer not found.", false);
    }

    if (vol.email_token !== token) {
      return htmlResponse("Invalid or already-used verification link.", false);
    }

    if (!vol.pending_email) {
      return htmlResponse("No email address pending verification.", false);
    }

    // Check expiry
    if (vol.token_expires_at && new Date(vol.token_expires_at) < new Date()) {
      return htmlResponse("This verification link has expired. Please request a new one from the app.", false);
    }

    // Update email and clear pending state
    const { error: updateError } = await supabase
      .from("volunteers")
      .update({
        email: vol.pending_email,
        pending_email: null,
        email_token: null,
        token_expires_at: null,
      })
      .eq("id", volunteerId);

    if (updateError) {
      return htmlResponse("Failed to verify email. Please try again.", false);
    }

    return htmlResponse("Your email has been verified! You can close this page and return to the app.", true);
  } catch (e) {
    return htmlResponse("An unexpected error occurred.", false);
  }
});

function htmlResponse(message: string, success: boolean): Response {
  const color = success ? "#28a745" : "#dc3545";
  const icon = success ? "&#10003;" : "&#10007;";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zen Care — Email Verification</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8f9fa; color: #333; }
    .card { background: white; border-radius: 12px; padding: 40px; max-width: 400px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .icon { font-size: 48px; color: ${color}; margin-bottom: 16px; }
    h1 { font-size: 20px; margin-bottom: 12px; }
    p { color: #666; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${success ? "Email Verified" : "Verification Failed"}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: success ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
