import nodemailer from 'nodemailer';

function getTransport() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendNewsletter(opts: {
  to: string[];
  subject: string;
  html: string;
}): Promise<{ sent: number; errors: string[] }> {
  const transport = getTransport();
  const from = process.env.SMTP_FROM ?? 'no-reply@nodyx.org';
  const errors: string[] = [];
  let sent = 0;

  for (const email of opts.to) {
    try {
      await transport.sendMail({ from, to: email, subject: opts.subject, html: opts.html });
      sent++;
    } catch (e: unknown) {
      errors.push(`${email}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { sent, errors };
}
