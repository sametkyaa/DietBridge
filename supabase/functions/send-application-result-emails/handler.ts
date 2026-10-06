// Sends queued dietitian application result e-mails (approval / rejection).
// The queue (private.application_result_emails) is filled by a database
// trigger on every Product Admin decision; this handler only drains it.
//
// Callers:
//   * a Platform Admin from the Web panel right after a decision
//     (Authorization: Bearer <admin user JWT>);
//   * a scheduler holding the service-role key.
// Without provider configuration the handler refuses before claiming, so
// queued rows stay pending and nothing is reported as sent.

export interface QueuedEmail {
  id: string;
  recipient_email: string;
  recipient_name: string | null;
  decision: 'approved' | 'rejected';
  rejection_reason: string | null;
  attempts: number;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface ApplicationEmailConfig {
  providerConfigured: boolean;
  panelUrl: string;
}

export interface ApplicationEmailDependencies {
  config: ApplicationEmailConfig;
  /** Resolves who is calling; never throws for an invalid token. */
  authorize: (authorization: string) => Promise<'service' | 'admin' | 'denied'>;
  claim: (limit: number) => Promise<QueuedEmail[]>;
  complete: (id: string, sent: boolean, providerMessageId: string | null, error: string | null) => Promise<void>;
  send: (message: EmailMessage) => Promise<{ id: string | null }>;
}

const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
  'cache-control': 'no-store',
  'content-type': 'application/json',
};

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const greeting = (name: string | null): string => {
  const trimmed = name?.trim();
  return trimmed ? `Merhaba ${trimmed},` : 'Merhaba,';
};

export const buildApplicationResultEmail = (row: QueuedEmail, panelUrl: string): EmailMessage => {
  const lines = row.decision === 'approved'
    ? [
      greeting(row.recipient_name),
      '',
      'DietBridge diyetisyen başvurunuz onaylandı. Artık panele giriş yaparak danışanlarınızla çalışmaya başlayabilirsiniz.',
      '',
      `Panele giriş: ${panelUrl}`,
    ]
    : [
      greeting(row.recipient_name),
      '',
      'DietBridge diyetisyen başvurunuz bu aşamada onaylanmadı.',
      ...(row.rejection_reason?.trim() ? ['', `Gerekçe: ${row.rejection_reason.trim()}`] : []),
      '',
      'Sorularınız için bu e-postayı yanıtlayabilirsiniz.',
    ];
  const text = [...lines, '', 'DietBridge'].join('\n');
  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.55;color:#18221D">${
    lines.map((line) => (line ? `<p style="margin:0 0 4px">${escapeHtml(line)}</p>` : '<br>')).join('')
  }<p style="margin:16px 0 0;color:#56625B">DietBridge</p></div>`;
  return {
    to: row.recipient_email,
    subject: row.decision === 'approved'
      ? 'DietBridge başvurunuz onaylandı'
      : 'DietBridge başvurunuz hakkında',
    text,
    html,
  };
};

export async function handleApplicationResultEmails(
  request: Request,
  dependencies: ApplicationEmailDependencies,
): Promise<Response> {
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ result: 'error' }, 405);

  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer \S+$/i.test(authorization)) return json({ result: 'unauthorized' }, 401);

  const caller = await dependencies.authorize(authorization).catch(() => 'denied' as const);
  if (caller === 'denied') return json({ result: 'forbidden' }, 403);

  if (!dependencies.config.providerConfigured) {
    return json({ result: 'provider_not_configured' }, 503);
  }

  let rows: QueuedEmail[];
  try {
    rows = await dependencies.claim(caller === 'service' ? 25 : 10);
  } catch {
    return json({ result: 'error' }, 500);
  }

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const message = buildApplicationResultEmail(row, dependencies.config.panelUrl);
      const outcome = await dependencies.send(message);
      await dependencies.complete(row.id, true, outcome.id, null);
      sent += 1;
    } catch (error) {
      failed += 1;
      const reason = error instanceof Error ? error.message.slice(0, 200) : 'send_failed';
      await dependencies.complete(row.id, false, null, reason).catch(() => undefined);
    }
  }

  return json({ result: 'ok', claimed: rows.length, sent, failed });
}
