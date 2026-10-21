const nodemailer = require('nodemailer');

function getTransporter() {
  const user = (process.env.GMAIL_USER || process.env.EMAIL_USER || '').trim();
  const rawPass = (process.env.GMAIL_APP_PASS || process.env.EMAIL_PASS || '').trim();
  const pass = rawPass.replace(/^["']|["']$/g, '').replace(/\s+/g, '');

  if (!user || !pass) {
    console.warn('[mailer] Warning: Gmail SMTP credentials (GMAIL_USER or GMAIL_APP_PASS) not set in environment.');
    return null;
  }

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // Direct SSL port 465 connects reliably from cloud environments like Render
    auth: {
      user,
      pass
    },
    tls: {
      rejectUnauthorized: false
    }
  });
}

/**
 * Sends a 6-digit OTP verification code via Gmail SMTP
 */
async function sendOTPEmail(toEmail, otpCode) {
  const user = (process.env.GMAIL_USER || process.env.EMAIL_USER || '').trim();
  const transporter = getTransporter();

  if (!transporter) {
    console.log(`[mailer:dev-mode] No SMTP configured. Fallback OTP for ${toEmail}: ${otpCode}`);
    return true;
  }

  const mailOptions = {
    from: `"DadAI Activation" <${user}>`,
    to: toEmail,
    subject: `Your DadAI Verification Code: ${otpCode}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background: #0b101c; color: #f8fafc; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
        <h2 style="color: #38bdf8; margin-top: 0;">DadAI Account Verification</h2>
        <p style="color: #94a3b8; font-size: 14px;">Use the verification code below to complete your registration and bind your device license:</p>
        <div style="background: rgba(56, 189, 248, 0.1); border: 1px solid #38bdf8; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #38bdf8; font-family: monospace;">${otpCode}</span>
        </div>
        <p style="color: #64748b; font-size: 12px; margin-bottom: 0;">This code will expire in 10 minutes. If you did not request this activation, you can safely ignore this email.</p>
      </div>
    `
  };

  const info = await transporter.sendMail(mailOptions);
  console.log(`[mailer] OTP email successfully sent to ${toEmail}. MessageId: ${info.messageId}`);
  return true;
}

module.exports = { sendOTPEmail };

