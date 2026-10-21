/**
 * DadAI Mailer Gateway
 * Sends OTP verification emails using Google Apps Script Webhook (Port 443 HTTPS).
 * 100% Free, no custom domain required, sends directly from your personal/workspace Gmail!
 */

async function sendOTPEmail(toEmail, otpCode) {
  // Always log prominently to server console so you can see it in Render dashboard
  console.log(`\n========================================`);
  console.log(`[OTP] Destination: ${toEmail}`);
  console.log(`[OTP] Verification Code: >>> ${otpCode} <<<`);
  console.log(`========================================\n`);

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background: #0b101c; color: #f8fafc; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
      <h2 style="color: #38bdf8; margin-top: 0;">DadAI Account Verification</h2>
      <p style="color: #94a3b8; font-size: 14px;">Use the verification code below to complete your registration and bind your device license:</p>
      <div style="background: rgba(56, 189, 248, 0.1); border: 1px solid #38bdf8; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0;">
        <span style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #38bdf8; font-family: monospace;">${otpCode}</span>
      </div>
      <p style="color: #64748b; font-size: 12px; margin-bottom: 0;">This code will expire in 10 minutes. If you did not request this activation, you can safely ignore this email.</p>
    </div>
  `;

  // Google Mail Webhook Gateway (HTTPS Port 443 - 100% Free, No Custom Domain Required, Sends from Gmail to ANY recipient!)
  const googleWebhook = (process.env.GOOGLE_MAIL_WEBHOOK || '').trim();
  if (googleWebhook) {
    try {
      const res = await fetch(googleWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: toEmail,
          subject: `Your DadAI Verification Code: ${otpCode}`,
          html: htmlBody
        })
      });
      if (res.ok) {
        console.log(`[mailer:google-script] Email successfully dispatched via Google Webhook to ${toEmail}`);
        return true;
      } else {
        const text = await res.text();
        console.warn(`[mailer:google-script] Webhook returned status ${res.status}: ${text}`);
      }
    } catch (gErr) {
      console.warn(`[mailer:google-script] Webhook dispatch error:`, gErr.message);
    }
  } else {
    console.warn(`[mailer] GOOGLE_MAIL_WEBHOOK is not set in environment variables. OTP logged to console above.`);
  }

  return true;
}

module.exports = { sendOTPEmail };
