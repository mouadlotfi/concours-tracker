import { configDefaults, mailEnabled, getAppBaseUrl } from './config';
import type { Env } from './config';
import { createUnsubscribeToken } from './unsubscribe-token';
import type { MatchedConcours } from './scraper';

/** Escape HTML special characters to prevent injection in email templates. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type emailAddress = { email: string; name?: string };

type emailPayload = {
  sender: emailAddress;
  to?: emailAddress[];
  subject: string;
  htmlContent: string;
  textContent: string;
  messageVersions?: Array<{
    to: emailAddress[];
    subject?: string;
    htmlContent?: string;
    textContent?: string;
  }>;
};

async function sendemail(payload: emailPayload, env: Env): Promise<boolean> {
  if (!mailEnabled(env)) return false;

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.SMTP_API_KEY || '',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const raw = await res.text().catch(() => '');
  if (!res.ok) {
    console.error('[email] http failure', { status: res.status, body: raw.slice(0, 2000) });
    return false;
  }

  try {
    const parsed = raw ? (JSON.parse(raw) as any) : null;
    const messageId = parsed?.messageId;
    if (messageId) {
      console.log('[email] send ok', { messageId: String(messageId) });
    }
  } catch {
  }

  return true;
}

function buildNotifyHtml(concoursList: MatchedConcours[], unsubUrl: string): string {
  const mono = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
  const bg = '#f6f7fb';
  const surface = '#ffffff';
  const accent = '#4f46e5';
  const text = '#111118';
  const textDim = 'rgba(17,17,24,0.58)';
  const border = 'rgba(16,16,24,0.14)';

  const detailLine = (label: string, value: string | undefined) => {
    if (!value) return '';
    return `<p style="margin:4px 0 0;font-size:11px;font-family:${mono};color:${textDim};letter-spacing:0.3px;">${escapeHtml(label)} &mdash; ${escapeHtml(value)}</p>`;
  };

  let itemsHtml = '';
  for (const c of concoursList) {
    const title = escapeHtml(c.title || 'Sans titre');
    const url = escapeHtml(c.sourceUrl || c.wadifaUrl || '#');
    const deadlineDate = c.depositDeadlineIso?.split('T')[0]?.split('-').reverse().join('-');
    itemsHtml += `
      <tr><td style="padding:0 0 12px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:${surface};border:1px solid ${border};border-radius:6px;">
          <tr><td style="padding:16px 18px;">
            <div style="position:relative;">
              <a href="${url}" style="color:${text};font-family:${mono};font-size:13px;font-weight:400;text-decoration:none;line-height:1.5;letter-spacing:0.2px;">${title}</a>
              ${detailLine('DATE LIMITE DE DÉPÔT', deadlineDate)}
              ${detailLine('DATE DU CONCOURS', c.concoursDateIso?.split('T')[0]?.split('-').reverse().join('-'))}
              ${detailLine('ADMINISTRATION', c.details?.['Administration qui recrute'])}
              ${detailLine('DIPLÔMES REQUIS', c.details?.['Diplômes requis'])}
              ${detailLine('SPÉCIALITÉS REQUISES', c.details?.['Spécialités requises'])}
              ${detailLine('TYPE DE DÉPÔT', c.details?.['Type de dépôt'])}
              <div style="margin-top:10px;">
                <a href="${url}" style="display:inline-block;font-family:${mono};font-size:10px;text-transform:uppercase;letter-spacing:2px;color:${accent};text-decoration:none;padding:6px 14px;border:1px solid ${accent};border-radius:4px;">VOIR &rarr;</a>
              </div>
            </div>
          </td></tr>
        </table>
      </td></tr>`;
  }

  return `<!DOCTYPE html>
<html lang="fr">
<body style="margin:0;padding:0;background:${bg};font-family:${mono};-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${bg};">
    <tr><td align="center" style="padding:48px 20px;">
      <table width="580" cellpadding="0" cellspacing="0">
        <!-- Header -->
        <tr><td style="padding:0 0 28px;text-align:center;">
          <p style="margin:0 0 4px;font-size:10px;text-transform:uppercase;letter-spacing:4px;color:${accent};font-family:${mono};">CONCOURS</p>
          <h1 style="margin:0;font-size:22px;font-weight:400;color:${text};letter-spacing:0.3px;font-family:${mono};">D&eacute;veloppement Web</h1>
        </td></tr>

        <!-- Main card -->
        <tr><td>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:${surface};border:1px solid ${border};border-radius:8px;">
            <tr><td style="padding:28px 24px 24px;">
              <!-- Badge + title -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
                <tr>
                  <td style="background:${accent};color:#ffffff;font-family:${mono};font-size:10px;text-transform:uppercase;letter-spacing:2px;padding:4px 12px;border-radius:999px;">${concoursList.length} nouveau${concoursList.length > 1 ? 'x' : ''}</td>
                </tr>
              </table>

              <!-- Concours list -->
              <table width="100%" cellpadding="0" cellspacing="0">${itemsHtml}</table>
            </td></tr>
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 0 0;text-align:center;">
          <p style="margin:0;font-family:${mono};font-size:10px;color:${textDim};letter-spacing:0.3px;">
            <a href="${unsubUrl}" style="color:${textDim};text-decoration:none;letter-spacing:0.5px;">Se d&eacute;sabonner</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildNotifyText(concoursList: MatchedConcours[], unsubUrl: string): string {
  const lines: string[] = [];
  lines.push(`Concours Développement Web — ${concoursList.length} nouveau${concoursList.length > 1 ? 'x' : ''} concours`);
  lines.push('');
  for (const c of concoursList) {
    lines.push(`- ${c.title}`);
    lines.push(`  ${c.sourceUrl || c.wadifaUrl}`);
    if (c.depositDeadlineIso) lines.push(`  Date limite de dépôt: ${c.depositDeadlineIso.split('T')[0].split('-').reverse().join('-')}`);
    if (c.concoursDateIso) lines.push(`  Date du concours: ${c.concoursDateIso.split('T')[0].split('-').reverse().join('-')}`);
    if (c.details?.['Administration qui recrute']) lines.push(`  Administration: ${c.details['Administration qui recrute']}`);
    if (c.details?.['Diplômes requis']) lines.push(`  Diplômes requis: ${c.details['Diplômes requis']}`);
    if (c.details?.['Spécialités requises']) lines.push(`  Spécialités requises: ${c.details['Spécialités requises']}`);
    if (c.details?.['Type de dépôt']) lines.push(`  Type de dépôt: ${c.details['Type de dépôt']}`);
  }
  lines.push('');
  lines.push(`Se désabonner: ${unsubUrl}`);
  return lines.join('\n');
}

function buildWelcomeHtml(unsubUrl: string, rssUrl: string): string {
  const mono = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
  const bg = '#f6f7fb';
  const surface = '#ffffff';
  const accent = '#4f46e5';
  const text = '#111118';
  const textDim = 'rgba(17,17,24,0.58)';
  const border = 'rgba(16,16,24,0.14)';
  return `<!DOCTYPE html>
<html lang="fr">
<body style="margin:0;padding:0;background:${bg};font-family:${mono};-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${bg};">
    <tr><td align="center" style="padding:48px 20px;">
      <table width="580" cellpadding="0" cellspacing="0">
        <!-- Header -->
        <tr><td style="padding:0 0 28px;text-align:center;">
          <p style="margin:0 0 4px;font-size:10px;text-transform:uppercase;letter-spacing:4px;color:${accent};font-family:${mono};">CONCOURS</p>
          <h1 style="margin:0;font-size:22px;font-weight:400;color:${text};letter-spacing:0.3px;font-family:${mono};">D&eacute;veloppement Web</h1>
        </td></tr>

        <!-- Main card -->
        <tr><td>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:${surface};border:1px solid ${border};border-radius:8px;">
            <tr><td style="padding:28px 24px 24px;">
              <!-- Badge -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
                <tr>
                  <td style="background:${accent};color:#ffffff;font-family:${mono};font-size:10px;text-transform:uppercase;letter-spacing:2px;padding:4px 12px;border-radius:999px;">confirm&eacute;</td>
                </tr>
              </table>

              <h2 style="margin:0 0 12px;font-family:${mono};font-size:16px;font-weight:400;color:${text};letter-spacing:0.2px;">Abonnement confirm&eacute;</h2>
              <p style="margin:0 0 22px;font-family:${mono};font-size:12px;line-height:1.7;color:${textDim};font-weight:300;">Vous recevrez un email &agrave; chaque nouveau concours d&eacute;tect&eacute; comme relevant du d&eacute;veloppement web.</p>

              <!-- RSS box -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="padding:14px 18px;border:1px solid ${border};border-radius:6px;background:${bg};">
                  <p style="margin:0 0 4px;font-family:${mono};font-size:10px;text-transform:uppercase;letter-spacing:2px;color:${textDim};">FLUX RSS</p>
                  <a href="${rssUrl}" style="font-family:${mono};font-size:12px;color:${accent};text-decoration:none;word-break:break-all;">${rssUrl}</a>
                </td></tr>
              </table>
            </td></tr>
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 0 0;text-align:center;">
          <p style="margin:0;font-family:${mono};font-size:10px;color:${textDim};letter-spacing:0.3px;">
            <a href="${unsubUrl}" style="color:${textDim};text-decoration:none;letter-spacing:0.5px;">Se d&eacute;sabonner</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildWelcomeText(unsubUrl: string, rssUrl: string): string {
  return [
    'Abonnement confirme — Concours Developpement Web',
    '',
    'Vous recevrez un email à chaque nouveau concours détecté comme relevant du développement web.',
    '',
    `Flux RSS: ${rssUrl}`,
    '',
    `Se désabonner: ${unsubUrl}`,
  ].join('\n');
}

export async function sendWelcomeEmail(email: string, env: Env): Promise<boolean> {
  if (!mailEnabled(env)) return false;
  let token = '';
  try {
    token = createUnsubscribeToken(email, env);
  } catch {
    token = '';
  }
  const appBaseUrl = getAppBaseUrl(env);
  const unsubUrl = token ? `${appBaseUrl}/unsubscribe?token=${encodeURIComponent(token)}` : `${appBaseUrl}/unsubscribe`;
  const rssUrl = `${appBaseUrl}/feed.xml`;

  return sendemail({
    sender: { email: env.SMTP_SENDER_EMAIL || '', name: env.SMTP_SENDER_NAME || 'Concours Developpement Web' },
    to: [{ email }],
    subject: 'Abonnement confirme — Concours Developpement Web',
    textContent: buildWelcomeText(unsubUrl, rssUrl),
    htmlContent: buildWelcomeHtml(unsubUrl, rssUrl),
  }, env);
}

export async function notifySubscribers(
  subscribers: Array<{ email: string }>,
  concoursList: MatchedConcours[],
  env: Env
): Promise<boolean> {
  if (!mailEnabled(env)) return false;
  if (!subscribers.length || !concoursList.length) return true;

  const appBaseUrl = getAppBaseUrl(env);
  const sender = { email: env.SMTP_SENDER_EMAIL || '', name: env.SMTP_SENDER_NAME || 'Concours Developpement Web' };
  let okAll = true;

  const subject =
    concoursList.length === 1
      ? `Nouveau concours: ${(concoursList[0]?.title || '').slice(0, 60)}`
      : `${concoursList.length} nouveaux concours — Développement Web`;

  for (let i = 0; i < subscribers.length; i += 50) {
    const batch = subscribers.slice(i, i + 50);

    const versions = batch.map((s) => {
      let token = '';
      try {
        token = createUnsubscribeToken(s.email, env);
      } catch {
        token = '';
      }
      const unsubUrl = token
        ? `${appBaseUrl}/unsubscribe?token=${encodeURIComponent(token)}`
        : `${appBaseUrl}/unsubscribe`;
      return {
        to: [{ email: s.email }],
        subject,
        textContent: buildNotifyText(concoursList, unsubUrl),
        htmlContent: buildNotifyHtml(concoursList, unsubUrl),
      };
    });

    const baseUnsub = `${appBaseUrl}/unsubscribe`;
    const batchOk = await sendemail({
      sender,
      subject,
      textContent: buildNotifyText(concoursList, baseUnsub),
      htmlContent: buildNotifyHtml(concoursList, baseUnsub),
      messageVersions: versions,
    }, env);

    if (!batchOk) {
      let fallbackOk = true;
      for (const s of batch) {
        let token = '';
        try {
          token = createUnsubscribeToken(s.email, env);
        } catch {
          token = '';
        }
        const unsubUrl = token
          ? `${appBaseUrl}/unsubscribe?token=${encodeURIComponent(token)}`
          : `${appBaseUrl}/unsubscribe`;
        const singleOk = await sendemail({
          sender,
          to: [{ email: s.email }],
          subject,
          textContent: buildNotifyText(concoursList, unsubUrl),
          htmlContent: buildNotifyHtml(concoursList, unsubUrl),
        }, env);
        fallbackOk = fallbackOk && singleOk;
      }
      okAll = okAll && fallbackOk;
    }
  }

  return okAll;
}
