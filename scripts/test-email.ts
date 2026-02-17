/**
 * Send a test notification email with sample concours data.
 *
 * Usage:
 *   bun run scripts/test-email.ts your@email.com
 */
import { notifySubscribers } from '../src/lib/mailer.js';
import type { MatchedConcours } from '../src/lib/wadifa.js';

const email = process.argv[2];
if (!email) {
  console.error('Usage: bun run scripts/test-email.ts <your@email.com>');
  process.exit(1);
}

const sample: MatchedConcours[] = [
  {
    id: 'test-1',
    wadifaUrl: 'https://www.wadifa-info.com/fr/54119/example',
    sourceUrl:
      'https://www.emploi-public.ma/fr/concours/details/2c8b6319-5234-4b64-9df6-f5de399a0478',
    title:
      "Ministère de l'intérieur — Concours de recrutement de 1 Administrateur 2ème grade",
    matchReason: 'keyword: informatique',
    depositDeadlineIso: '2026-03-06T23:59:59.999Z',
    concoursDateIso: '2026-03-29T00:00:00.000Z',
    details: {
      'Administration qui recrute':
        "Ministère de l'intérieur — Préfecture de Beni Mellal",
      'Diplômes requis': 'Master',
      'Spécialités requises': 'audit et contrôle de gestion',
      'Type de dépôt': 'Dépôt électronique et dépôt physique',
    },
  },
  {
    id: 'test-2',
    wadifaUrl: 'https://www.wadifa-info.com/fr/54118/example',
    sourceUrl: null,
    title:
      'Ministère de la Santé — Concours de recrutement de 5 Ingénieurs en Informatique',
    matchReason: 'keyword: developpement',
    depositDeadlineIso: '2026-04-15T23:59:59.999Z',
    concoursDateIso: null,
    details: {
      'Administration qui recrute': 'Ministère de la Santé et de la Protection Sociale',
      'Diplômes requis': "Diplôme d'ingénieur",
      'Spécialités requises': 'Informatique, Systèmes et Réseaux',
      'Type de dépôt': 'Dépôt électronique',
    },
  },
];

console.log(`Sending test notification to ${email} …`);

const ok = await notifySubscribers([{ email }], sample);

if (ok) {
  console.log('✓ Email sent — check your inbox.');
} else {
  console.error('✗ Email failed to send. Check your BREVO_API_KEY.');
}
