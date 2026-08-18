import { Resend } from 'resend';
import nodemailer from 'nodemailer';

let resendClient = null;
let smtpTransporter = null;

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!resendClient) resendClient = new Resend(apiKey);
  return resendClient;
}

function getSMTPTransporter() {
  if (smtpTransporter) return smtpTransporter;
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host) return null;

  smtpTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
  });
  return smtpTransporter;
}

function resolveTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, String(value || ''));
  }
  return result;
}

function buildEmailHTML({ headline, opening, bodyParagraphs, closing, accentColor, senderName, companyName, trackingPixelUrl, clickLinks }) {
  const body = bodyParagraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#333;">${escapeHtml(p)}</p>`)
    .join('');

  const wrappedOpening = clickLinks?.opening
    ? wrapLinks(opening, clickLinks.opening)
    : escapeHtml(opening);
  const wrappedClosing = clickLinks?.closing
    ? wrapLinks(closing, clickLinks.closing)
    : escapeHtml(closing);
  const wrappedBody = bodyParagraphs.map((p, i) =>
    clickLinks?.[`body_${i}`]
      ? wrapLinks(p, clickLinks[`body_${i}`])
      : escapeHtml(p)
  ).map((html) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#333;">${html}</p>`).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f5f5f5;">
<div style="max-width:600px;margin:0 auto;padding:32px 24px;background:#ffffff;">
  <h1 style="font-size:22px;font-weight:700;color:${accentColor || '#1a1a1a'};margin:0 0 20px;line-height:1.3;">
    ${escapeHtml(headline || '')}
  </h1>
  <div style="font-size:15px;line-height:1.6;color:#333;">
    <p style="margin:0 0 14px;">${wrappedOpening}</p>
    ${wrappedBody}
    <p style="margin:20px 0 0;padding-top:16px;border-top:1px solid #e5e5e5;">${wrappedClosing}</p>
  </div>
  ${senderName ? `<p style="margin:24px 0 0;font-size:13px;color:#999;">— ${escapeHtml(senderName)}</p>` : ''}
</div>
${trackingPixelUrl ? `<img src="${trackingPixelUrl}" width="1" height="1" style="display:none;" />` : ''}
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapLinks(text, baseUrl) {
  const escaped = escapeHtml(text);
  return escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${baseUrl}?url=${encodeURIComponent(url)}" style="color:#0066cc;">${url}</a>`
  );
}

export async function sendEmail({ to, subject, html, from, provider: providerOverride }) {
  const provider = providerOverride || process.env.EMAIL_PROVIDER || 'resend';

  if (provider === 'smtp') {
    const transporter = getSMTPTransporter();
    if (!transporter) throw new Error('SMTP not configured (set SMTP_HOST in .env)');
    const info = await transporter.sendMail({
      from: from || process.env.EMAIL_FROM || 'Homing <noreply@localhost>',
      to,
      subject,
      html,
    });
    return { id: info.messageId, provider: 'smtp' };
  }

  // Default: Resend
  const client = getResendClient();
  if (!client) throw new Error('Resend not configured (set RESEND_API_KEY in .env)');
  const result = await client.emails.send({
    from: from || process.env.EMAIL_FROM || 'Homing <onboarding@resend.dev>',
    to: [to],
    subject,
    html,
  });
  return { id: result.data?.id || result.id, provider: 'resend' };
}

export { resolveTemplate, buildEmailHTML, escapeHtml };
