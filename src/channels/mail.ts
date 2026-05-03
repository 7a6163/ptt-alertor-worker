import type { Env, DispatchEvent } from '../env';

export async function sendMail(env: Env, evt: DispatchEvent): Promise<void> {
  if (!env.MAILGUN_API_KEY || !env.MAILGUN_DOMAIN) {
    console.warn('MAILGUN_* missing — skipping mail send');
    return;
  }
  const form = new FormData();
  form.append('from', `Ptt Alertor <noreply@${env.MAILGUN_DOMAIN}>`);
  form.append('to', evt.externalId);
  form.append('subject', `[${evt.payload.board}] ${evt.payload.title}`);
  form.append('text', `${evt.payload.title}\n${evt.payload.url}`);

  const res = await fetch(`https://api.mailgun.net/v3/${env.MAILGUN_DOMAIN}/messages`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`api:${env.MAILGUN_API_KEY}`)}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`mailgun send ${res.status}: ${await res.text()}`);
  }
}
