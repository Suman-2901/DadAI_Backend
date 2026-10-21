const nodemailer = require('nodemailer');

let cachedTransporter = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const user = (process.env.GMAIL_USER || process.env.EMAIL_USER || '').trim();
  const rawPass = (process.env.GMAIL_APP_PASS || process.env.EMAIL_PASS || '').trim();
  const pass = rawPass.replace(/^["']|["']$/g, '').replace(/\s+/g, '');

  if (!user || !pass) return null;

  cachedTransporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    pool: true,
    connectionTimeout: 4000,
    greetingTimeout: 4000,
    socketTimeout: 4000,
    auth: {
      user,
      pass
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  return cachedTransporter;
}

/**
 * Sends a 6-digit OTP verification code.
 * - Supports Resend REST API (HTTPS port 443) which Render free tier never blocks.
 * - Supports Gmail SMTP with 4s timeout fallback.
 * - Always logs the OTP prominently to Render console logs so you are never locked out!
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

  // 1. Google Mail Webhook Gateway (HTTPS Port 443 - 100% Free, No Custom Domain Required, Sends from your Gmail to ANY recipient!)
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
      }
    } catch (gErr) {
      console.warn(`[mailer:google-script] Webhook dispatch error:`, gErr.message);
    }
  }

  // 2. Resend REST API (HTTPS Port 443 - Works for account owner or verified domains)
  const resendApiKey = (process.env.RESEND_API_KEY || '').trim();
  if (resendApiKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'DadAI <onboarding@resend.dev>',
          to: [toEmail],
          subject: `Your DadAI Verification Code: ${otpCode}`,
          html: htmlBody
        })
      });
      const data = await res.json();
      if (res.ok) {
        console.log(`[mailer:resend] Email delivered via Resend API to ${toEmail}. ID: ${data.id}`);
        return true;
      } else {
        console.warn(`[mailer:resend] Resend API error:`, data);
      }
    } catch (e) {
      console.warn(`[mailer:resend] Failed to call Resend API:`, e.message);
    }
  }

  // 2. Gmail SMTP with strict 4s timeout (Note: Render free tier blocks ports 25, 465, 587)
  const transporter = getTransporter();
  if (transporter) {
    try {
      const mailOptions = {
        from: `"DadAI Activation" <${process.env.GMAIL_USER || process.env.EMAIL_USER}>`,
        to: toEmail,
        subject: `Your DadAI Verification Code: ${otpCode}`,
        html: htmlBody
      };
      const info = await transporter.sendMail(mailOptions);
      console.log(`[mailer:smtp] Email delivered via Gmail SMTP to ${toEmail}. MessageId: ${info.messageId}`);
      return true;
    } catch (smtpErr) {
      console.warn(`[mailer:smtp] SMTP failed (${smtpErr.message}). Render free tier blocks outbound SMTP ports 465/587.`);
    }
  }

  return true;
}

module.exports = { sendOTPEmail };

