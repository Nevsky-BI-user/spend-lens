// Надсилання PDF-звіту поштою (Gmail SMTP, smtp.gmail.com:465, TLS).
// Єдина npm-залежність модуля — nodemailer.
// Якщо env не задано (SMTP_USER / SMTP_APP_PASSWORD / REPORT_TO) —
// надсилання пропускається м'яко: лог і повернення false (процес завершується з exit 0).

import nodemailer from 'nodemailer';

/**
 * @param {{ subject: string, text: string, pdfPath: string, filename: string }} opts
 * @returns {Promise<boolean>} true — надіслано; false — пропущено (немає env)
 */
export async function sendReport({ subject, text, pdfPath, filename }) {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_APP_PASSWORD;
  const to = process.env.REPORT_TO;

  const missing = [];
  if (!user) missing.push('SMTP_USER');
  if (!pass) missing.push('SMTP_APP_PASSWORD');
  if (!to) missing.push('REPORT_TO');
  if (missing.length) {
    console.log(`[mailer] email пропущено: не задано ${missing.join(', ')} (див. report/.env.example)`);
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: `"spend-lens" <${user}>`,
    to,
    subject,
    text,
    attachments: [{ filename, path: pdfPath }],
  });

  console.log(`[mailer] надіслано: ${to} (${filename})`);
  return true;
}
