import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { getPool } from '$lib/server/pg.js';
import { getDb } from '$lib/server/db.js';
import { sendNewsletter } from '$lib/server/mailer.js';

export const load: PageServerLoad = async () => {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT name, url, admin_email FROM directory_instances WHERE status='active' AND admin_email IS NOT NULL`
  );
  const db = getDb();
  const history = db.prepare(`SELECT * FROM newsletter ORDER BY sent_at DESC LIMIT 20`).all();
  return {
    recipients: rows as { name: string; url: string; admin_email: string }[],
    history: history as { id: number; subject: string; recipients: number; sent_at: number }[],
  };
};

export const actions: Actions = {
  send: async ({ request }) => {
    const form    = await request.formData();
    const subject = String(form.get('subject') ?? '').trim();
    const body    = String(form.get('body') ?? '').trim();

    if (!subject) return fail(400, { error: 'Objet requis.' });
    if (!body)    return fail(400, { error: 'Contenu requis.' });

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT admin_email FROM directory_instances WHERE status='active' AND admin_email IS NOT NULL`
    );
    const emails = rows.map((r: { admin_email: string }) => r.admin_email);

    if (emails.length === 0) return fail(400, { error: 'Aucun destinataire disponible.' });

    const html = `
      <!DOCTYPE html><html><body style="background:#020408;color:#f1f5f9;font-family:system-ui;max-width:600px;margin:0 auto;padding:2rem;">
        <div style="border-bottom:2px solid #3b82f6;padding-bottom:1rem;margin-bottom:2rem;">
          <span style="font-size:1.5rem;color:#3b82f6;">◈</span>
          <strong style="font-size:1rem;margin-left:0.5rem;">NODYX — Mise à jour</strong>
        </div>
        ${body.replace(/\n/g, '<br>')}
        <div style="border-top:1px solid rgba(56,78,180,0.3);padding-top:1rem;margin-top:2rem;color:#475569;font-size:0.75rem;">
          Vous recevez cet email car votre instance Nodyx est enregistrée dans le directory.<br>
          <a href="https://nodyx.org" style="color:#3b82f6;">nodyx.org</a>
        </div>
      </body></html>
    `;

    const { sent, errors } = await sendNewsletter({ to: emails, subject, html });

    // Save to history
    getDb().prepare(
      `INSERT INTO newsletter (subject, body_html, recipients, sent_at) VALUES (?,?,?,?)`
    ).run(subject, html, sent, Date.now());

    return { success: true, sent, errors };
  }
};
