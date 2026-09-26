import { mailEnabled, mailpitEnabled, getAppBaseUrl } from './config';
import type { Env } from './config';
import { createUnsubscribeToken } from './unsubscribe-token';
import { createConfirmToken } from './confirm-token';
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

const mailpitDefaultSender = 'dev@concours.local';

/** Resolve the From address, falling back to a local-only default when Mailpit is configured. */
function resolveSender(env: Env): emailAddress {
  const email = env.SMTP_SENDER_EMAIL || (mailpitEnabled(env) ? mailpitDefaultSender : '');
  const name = env.SMTP_SENDER_NAME || 'Concours Developpement Informatique';
  return { email, name };
}

type mailpitAddress = { Email: string; Name?: string };

type mailpitMessage = {
  From: mailpitAddress;
  To: mailpitAddress[];
  Subject: string;
  HTML: string;
  Text: string;
};

function toMailpitAddress(address: emailAddress): mailpitAddress {
  return address.name ? { Email: address.email, Name: address.name } : { Email: address.email };
}

/**
 * Translate a Brevo-style payload into one Mailpit message per recipient.
 * Brevo batches recipients via `messageVersions`; Mailpit has no batch API.
 */
export function toMailpitMessages(payload: emailPayload): mailpitMessage[] {
  const versions = payload.messageVersions?.length
    ? payload.messageVersions
    : [{ to: payload.to ?? [] }];

  return versions.map((version) => ({
    From: toMailpitAddress(payload.sender),
    To: version.to.map(toMailpitAddress),
    Subject: version.subject ?? payload.subject,
    HTML: version.htmlContent ?? payload.htmlContent,
    Text: version.textContent ?? payload.textContent,
  }));
}

async function sendViaMailpit(payload: emailPayload, env: Env): Promise<boolean> {
  const baseUrl = (env.MAILPIT_URL || '').replace(/\/+$/, '');
  const messages = toMailpitMessages(payload);

  let okAll = true;
  for (const message of messages) {
    const res = await fetch(`${baseUrl}/api/v1/send`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });

    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      console.error('[email] mailpit send failed', { status: res.status, body: raw.slice(0, 2000) });
      okAll = false;
    }
  }

  if (okAll) {
    console.log('[email] mailpit send ok', { messages: messages.length });
  }

  return okAll;
}

async function sendViaBrevo(payload: emailPayload, env: Env): Promise<boolean> {
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
    const parsed = raw ? (JSON.parse(raw) as { messageId?: unknown }) : null;
    const messageId = parsed?.messageId;
    if (messageId) {
      console.log('[email] send ok', { messageId: String(messageId) });
    }
  } catch {
  }

  return true;
}

async function sendemail(payload: emailPayload, env: Env): Promise<boolean> {
  if (!mailEnabled(env)) return false;
  if (mailpitEnabled(env)) return sendViaMailpit(payload, env);
  return sendViaBrevo(payload, env);
}

// Design tokens mirrored from public/css/globals.css so mail matches the site.
const MONO =
  "'Departure Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
const THEME = {
  bg: '#f6f7fb',
  surface: '#ffffff',
  border: 'rgba(16,16,24,0.14)',
  borderSoft: 'rgba(16,16,24,0.10)',
  title: '#121224',
  textMid: 'rgba(17,17,24,0.78)',
  textDim: 'rgba(17,17,24,0.58)',
  label: 'rgba(17,17,24,0.52)',
  accent: '#4f46e5',
  accentBg: 'rgba(79,70,229,0.07)',
  accentBorder: 'rgba(79,70,229,0.16)',
  grid: 'rgba(79,70,229,0.06)',
} as const;

/** Format an ISO timestamp as DD-MM-YYYY. */
function frDate(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const parts = iso.split('T')[0]?.split('-') ?? [];
  if (parts.length !== 3) return iso;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

/** Nearest deposit deadline first; entries without a deadline sink to the bottom. */
function byNearestDeadline(a: MatchedConcours, b: MatchedConcours): number {
  const da = a.depositDeadlineIso ?? '';
  const db = b.depositDeadlineIso ?? '';
  if (!da && !db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return da.localeCompare(db);
}

/** <head> for every mail: embeds the site font and mobile tweaks. */
function emailHead(appBaseUrl: string): string {
  return `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <style>
    @font-face {
      font-family: 'Departure Mono';
      src: url('${appBaseUrl}/fonts/DepartureMono-Regular.woff2') format('woff2');
      font-weight: 400;
      font-style: normal;
    }
    body, table, td, a { -webkit-text-size-adjust: 100%; }
    body { margin: 0; padding: 0; }
    a { text-decoration: none; }
    @media (max-width: 520px) {
      .em-shell { padding-left: 14px !important; padding-right: 14px !important; }
      .em-card { padding-left: 18px !important; padding-right: 18px !important; }
      .em-h1 { font-size: 19px !important; }
      .em-cta { display: block !important; text-align: center !important; }
    }
  </style>`;
}

/** Page shell: indigo grid backdrop, brand header, white card, dim footer. */
function emailShell(
  appBaseUrl: string,
  opts: { preheader: string; card: string; footer: string }
): string {
  const gridBg =
    `background-color:${THEME.bg};` +
    `background-image:linear-gradient(${THEME.grid} 1px,transparent 1px),` +
    `linear-gradient(90deg,${THEME.grid} 1px,transparent 1px);` +
    `background-size:24px 24px;`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>${emailHead(appBaseUrl)}</head>
<body style="margin:0;padding:0;background:${THEME.bg};font-family:${MONO};-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${THEME.bg};font-size:1px;line-height:1px;">${escapeHtml(opts.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${gridBg}">
    <tr><td align="center" class="em-shell" style="padding:44px 20px 64px;">
      <table role="presentation" width="580" cellpadding="0" cellspacing="0" border="0" style="width:580px;max-width:100%;">
        <tr><td style="padding:0 0 24px;text-align:center;">
          <p style="margin:0 0 6px;font-family:${MONO};font-size:10px;letter-spacing:4px;text-transform:uppercase;color:${THEME.accent};">CONCOURS</p>
          <h1 class="em-h1" style="margin:0;font-family:${MONO};font-size:22px;font-weight:400;letter-spacing:-0.2px;text-transform:uppercase;color:${THEME.title};"><a href="${appBaseUrl}" style="color:inherit;">D&eacute;veloppement Informatique</a></h1>
        </td></tr>
        <tr><td style="background:${THEME.surface};border:1px solid ${THEME.border};border-radius:0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td class="em-card" style="padding:26px 24px 24px;">${opts.card}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:20px 2px 0;text-align:center;">${opts.footer}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function emailBadge(label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr>
    <td style="font-family:${MONO};font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${THEME.accent};background:${THEME.accentBg};border:1px solid ${THEME.accentBorder};padding:5px 11px;">${escapeHtml(label)}</td>
  </tr></table>`;
}

/** Accent-filled call to action, matching the site's submit button. */
function emailButton(href: string, label: string): string {
  return `<a class="em-cta" href="${href}" style="display:inline-block;font-family:${MONO};font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#ffffff;background:${THEME.accent};padding:9px 14px;border-radius:0;">${escapeHtml(label)} &rarr;</a>`;
}

function emailFooter(appBaseUrl: string, unsubUrl?: string): string {
  const link = `color:${THEME.textDim};`;
  const sep = `<span style="color:${THEME.border};">&nbsp;&middot;&nbsp;</span>`;
  const parts = [`<a href="${appBaseUrl}" style="${link}">Voir tous les concours</a>`];
  if (unsubUrl) parts.push(`<a href="${unsubUrl}" style="${link}">Se d&eacute;sabonner</a>`);
  parts.push(`<a href="${appBaseUrl}/feed.xml" style="${link}">RSS</a>`);
  return `<p style="margin:0;font-family:${MONO};font-size:10px;letter-spacing:0.5px;color:${THEME.textDim};">
    ${parts.join(`\n    ${sep}\n    `)}
  </p>`;
}

/** One concours, styled like the site's item card: sharp border, uppercase title, label/value rows. */
function emailItem(c: MatchedConcours, appBaseUrl: string): string {
  const title = escapeHtml(c.title || 'Sans titre');
  const url = escapeHtml(c.sourceUrl || c.wadifaUrl || appBaseUrl);
  const deadline = frDate(c.depositDeadlineIso);

  const rows: Array<{ k: string; v: string }> = [];
  const addRow = (k: string, v: string | undefined) => {
    if (v && v.trim()) rows.push({ k, v: v.trim() });
  };
  addRow('Date du concours', frDate(c.concoursDateIso));
  addRow('Administration', c.details?.['Administration qui recrute']);
  addRow('Diplômes requis', c.details?.['Diplômes requis']);
  addRow('Spécialités requises', c.details?.['Spécialités requises']);
  addRow('Type de dépôt', c.details?.['Type de dépôt']);

  const rowsHtml = rows
    .map(
      (r) => `<tr>
          <td style="padding:9px 12px 0 0;font-family:${MONO};font-size:10px;letter-spacing:1px;text-transform:uppercase;color:${THEME.label};vertical-align:top;width:38%;">${escapeHtml(r.k)}</td>
          <td style="padding:9px 0 0;font-family:${MONO};font-size:12px;line-height:1.5;color:${THEME.textMid};vertical-align:top;">${escapeHtml(r.v)}</td>
        </tr>`
    )
    .join('');

  const deadlinePill = deadline
    ? `<td style="vertical-align:top;text-align:right;white-space:nowrap;">
            <span style="display:inline-block;font-family:${MONO};font-size:11px;color:${THEME.accent};background:${THEME.accentBg};border:1px solid ${THEME.accentBorder};padding:5px 9px;">Limite&nbsp;${escapeHtml(deadline)}</span>
          </td>`
    : '';

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;background:${THEME.surface};border:1px solid ${THEME.border};border-radius:0;">
    <tr><td style="padding:16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="vertical-align:top;padding:0 12px 0 0;">
            <a href="${url}" style="font-family:${MONO};font-size:15px;line-height:1.3;text-transform:uppercase;color:rgba(17,17,24,0.92);">${title}</a>
          </td>
          ${deadlinePill}
        </tr>
      </table>
      ${rowsHtml ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowsHtml}</table>` : ''}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 0;">
        <tr><td style="border-top:1px dashed ${THEME.borderSoft};padding:12px 0 0;">
          ${emailButton(url, 'Voir le concours')}
        </td></tr>
      </table>
    </td></tr>
  </table>`;
}

function buildNotifyHtml(concoursList: MatchedConcours[], unsubUrl: string, appBaseUrl: string): string {
  const n = concoursList.length;
  const count = `${n} nouveau${n > 1 ? 'x' : ''}`;
  const card = `${emailBadge(count)}${concoursList.map((c) => emailItem(c, appBaseUrl)).join('')}`;
  return emailShell(appBaseUrl, {
    preheader: `${count} concours — Développement Informatique`,
    card,
    footer: emailFooter(appBaseUrl, unsubUrl),
  });
}

function buildNotifyText(concoursList: MatchedConcours[], unsubUrl: string): string {
  const lines: string[] = [];
  lines.push(`Concours Développement Informatique — ${concoursList.length} nouveau${concoursList.length > 1 ? 'x' : ''} concours`);
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

function buildWelcomeHtml(unsubUrl: string, appBaseUrl: string): string {
  const card = `${emailBadge('confirmé')}
    <h2 style="margin:0 0 12px;font-family:${MONO};font-size:16px;font-weight:400;letter-spacing:0.2px;text-transform:uppercase;color:${THEME.title};">Abonnement confirm&eacute;</h2>
    <p style="margin:0 0 22px;font-family:${MONO};font-size:12px;line-height:1.7;color:${THEME.textDim};">Vous recevrez un email &agrave; chaque nouveau concours d&eacute;tect&eacute; comme relevant du d&eacute;veloppement informatique.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr><td>${emailButton(appBaseUrl, 'Voir tous les concours')}</td></tr>
    </table>`;

  return emailShell(appBaseUrl, {
    preheader: 'Abonnement confirmé — Concours Développement Informatique',
    card,
    footer: emailFooter(appBaseUrl, unsubUrl),
  });
}

function buildWelcomeText(unsubUrl: string, rssUrl: string): string {
  return [
    'Abonnement confirme — Concours Developpement Informatique',
    '',
    'Vous recevrez un email à chaque nouveau concours détecté comme relevant du développement informatique.',
    '',
    `RSS: ${rssUrl}`,
    '',
    `Se désabonner: ${unsubUrl}`,
  ].join('\n');
}

function buildConfirmHtml(confirmUrl: string, appBaseUrl: string): string {
  const card = `${emailBadge('confirmation')}
    <h2 style="margin:0 0 12px;font-family:${MONO};font-size:16px;font-weight:400;letter-spacing:0.2px;text-transform:uppercase;color:${THEME.title};">Confirmez votre abonnement</h2>
    <p style="margin:0 0 22px;font-family:${MONO};font-size:12px;line-height:1.7;color:${THEME.textDim};">Cliquez sur le bouton ci-dessous pour confirmer votre adresse email et recevoir les nouveaux concours de d&eacute;veloppement informatique.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr><td>${emailButton(confirmUrl, "Confirmer mon abonnement")}</td></tr>
    </table>
    <p style="margin:18px 0 0;font-family:${MONO};font-size:11px;line-height:1.7;color:${THEME.label};">Si vous n&rsquo;&ecirc;tes pas &agrave; l&rsquo;origine de cette demande, ignorez simplement cet email. Ce lien expire dans 48 heures.</p>`;

  return emailShell(appBaseUrl, {
    preheader: 'Confirmez votre abonnement — Concours Développement Informatique',
    card,
    footer: emailFooter(appBaseUrl),
  });
}

function buildConfirmText(confirmUrl: string): string {
  return [
    'Confirmez votre abonnement — Concours Développement Informatique',
    '',
    'Cliquez sur ce lien pour confirmer votre adresse email :',
    confirmUrl,
    '',
    "Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.",
    'Ce lien expire dans 48 heures.',
  ].join('\n');
}

export async function sendConfirmEmail(email: string, env: Env): Promise<boolean> {
  if (!mailEnabled(env)) return false;
  let token = '';
  try {
    token = createConfirmToken(email, env);
  } catch {
    return false;
  }
  const appBaseUrl = getAppBaseUrl(env);
  const confirmUrl = `${appBaseUrl}/confirm?token=${encodeURIComponent(token)}`;

  return sendemail({
    sender: resolveSender(env),
    to: [{ email }],
    subject: 'Confirmez votre abonnement — Concours Developpement Informatique',
    textContent: buildConfirmText(confirmUrl),
    htmlContent: buildConfirmHtml(confirmUrl, appBaseUrl),
  }, env);
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
    sender: resolveSender(env),
    to: [{ email }],
    subject: 'Abonnement confirme — Concours Developpement Informatique',
    textContent: buildWelcomeText(unsubUrl, rssUrl),
    htmlContent: buildWelcomeHtml(unsubUrl, appBaseUrl),
  }, env);
}

export async function notifySubscribers(
  subscribers: Array<{ email: string }>,
  concoursList: MatchedConcours[],
  env: Env
): Promise<boolean> {
  if (!mailEnabled(env)) return false;
  if (!subscribers.length || !concoursList.length) return true;

  const items = [...concoursList].sort(byNearestDeadline);
  const appBaseUrl = getAppBaseUrl(env);
  const sender = resolveSender(env);
  let okAll = true;

  const subject =
    items.length === 1
      ? `Nouveau concours: ${(items[0]?.title || '').slice(0, 60)}`
      : `${items.length} nouveaux concours — Développement Informatique`;

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
        textContent: buildNotifyText(items, unsubUrl),
        htmlContent: buildNotifyHtml(items, unsubUrl, appBaseUrl),
      };
    });

    const baseUnsub = `${appBaseUrl}/unsubscribe`;
    const batchOk = await sendemail({
      sender,
      subject,
      textContent: buildNotifyText(items, baseUnsub),
      htmlContent: buildNotifyHtml(items, baseUnsub, appBaseUrl),
      messageVersions: versions,
    }, env);

    // A rejected batch can have accepted some recipients; retrying everyone duplicates mail.
    okAll = okAll && batchOk;
  }

  return okAll;
}
