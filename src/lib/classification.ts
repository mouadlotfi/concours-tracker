import { normalizeText } from './normalize';

export const CLASSIFIER_VERSION = 'hybrid-v4-pdf';

export type ClassificationSource = 'rules' | 'ai';

export type StoredClassification = {
  aiRelevant?: boolean;
  aiReason?: string;
  classificationVersion?: string;
  classificationHash?: string;
  classificationSource?: ClassificationSource;
  classificationModel?: string;
  classifiedAt?: string;
};

export type ClassificationCandidate = {
  id: string;
  title: string;
  details: Record<string, string>;
  classificationContext?: string;
  classificationDocumentUrl?: string;
  classificationDocumentDataUrl?: string;
};

export type ClassificationInput = {
  id: string;
  title: string;
  organization: string;
  specialties: string;
  diplomas: string;
  context: string;
};

export type RuleDecision =
  | { kind: 'accept'; evidence: string; reason: string }
  | { kind: 'reject'; reason: string }
  | { kind: 'ambiguous'; reason: string };

const STRONG_DEVELOPMENT_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'développement informatique', pattern: /\bdeveloppements?\s+informatique\b/ },
  { label: 'développement web', pattern: /\bdeveloppements?\s+web\b/ },
  { label: 'développement logiciel', pattern: /\bdeveloppements?\s+logiciels?\b/ },
  { label: 'génie logiciel', pattern: /\bgenie\s+logiciel\b/ },
  {
    label: 'techniques de développement',
    pattern: /\btechniques?\s+(?:de|du)\s+developpement(?:\s+(?:informatique|web|logiciel))?\b/,
  },
  { label: 'développeur', pattern: /\bdeveloppeu(?:r|se|rs|ses)\b/ },
  { label: 'programmation web/logicielle', pattern: /\bprogrammation\s+(?:web|logicielle?)\b/ },
  { label: 'frontend/backend/full-stack', pattern: /\b(?:front[ -]?end|back[ -]?end|full[ -]?stack)\b/ },
  { label: 'تطوير البرمجيات', pattern: /(?:تطوير\s+(?:ال)?برمجيات|هندسة\s+(?:ال)?برمجيات)/ },
  { label: 'تطوير الويب', pattern: /(?:تطوير\s+(?:ال)?ويب|تطوير\s+مواقع\s+(?:ال)?ويب)/ },
  { label: 'برمجة', pattern: /(?:برمجة\s+(?:ال)?ويب|مبرمج(?:ة|ون|ين)?|مطور(?:ة|ون|ين)?\s+(?:ال)?برمجيات)/ },
];

const AMBIGUOUS_SOFTWARE_PATTERN =
  /(?:\b(?:logiciels?|logicielle|applications?|applicatif|applicative|programmation|web|architecture\s+applicative)\b|تطوير\s+(?:ال)?برمجيات|هندسة\s+(?:ال)?برمجيات|تطوير\s+(?:ال)?ويب|برمجة|مبرمج|مطور\s+(?:ال)?برمجيات)/;

const GENERIC_IT_PATTERN =
  /(?:\b(?:informatique|genie\s+informatique|systemes?\s+d[' ]?information|reseaux?|securite\s+informatique|support\s+informatique)\b|المعلوميات|الإعلاميات)/;

const ALL_SPECIALTIES_PATTERN = /(?:\btoutes?\s+les\s+specialites\b|جميع\s+التخصصات)/;

const MANAGERIAL_ROLE_PATTERN =
  /(?:\b(?:directeur|directrice|responsable|manager|head\s+of|chef\s+(?:de|du|d[' ])\s*(?:projet|service|division|departement|pole|unite))\b|(?:مدير|مديرة|رئيس|رئيسة)\b)/;

function firstDetail(candidate: ClassificationCandidate, keys: string[]): string {
  for (const key of keys) {
    const value = candidate.details[key];
    if (value?.trim()) return value.trim();
  }
  return '';
}

export function getClassificationInput(candidate: ClassificationCandidate): ClassificationInput {
  return {
    id: candidate.id,
    title: candidate.title.trim(),
    organization: firstDetail(candidate, ['Administration qui recrute', 'Administration qui recrute :']),
    specialties: firstDetail(candidate, ['Spécialités requises', 'Spécialités requises :']),
    diplomas: firstDetail(candidate, ['Diplômes', 'Diplômes requis']),
    context: (candidate.classificationContext || '').trim().slice(0, 12_000),
  };
}

function normalizedPrimaryText(input: ClassificationInput): string {
  return normalizeText([input.title, input.specialties, input.diplomas].filter(Boolean).join(' | '));
}

function findStrongEvidence(normalized: string): string | null {
  for (const { label, pattern } of STRONG_DEVELOPMENT_PATTERNS) {
    if (pattern.test(normalized)) return label;
  }
  return null;
}

export function classifyByRules(candidate: ClassificationCandidate): RuleDecision {
  const input = getClassificationInput(candidate);
  const normalizedTitle = normalizeText(input.title);
  const primary = normalizedPrimaryText(input);

  // The tracker targets hands-on development jobs, not management positions,
  // even when the managed department contains "développement informatique".
  if (MANAGERIAL_ROLE_PATTERN.test(normalizedTitle)) {
    return {
      kind: 'reject',
      reason: 'Règle: poste de direction ou de management, pas un rôle de développement pratique.',
    };
  }

  const primaryEvidence = findStrongEvidence(primary);

  if (primaryEvidence) {
    return {
      kind: 'accept',
      evidence: primaryEvidence,
      reason: `Règle: mention explicite de ${primaryEvidence}.`,
    };
  }

  const contextEvidence = findStrongEvidence(normalizeText(input.context));
  if (contextEvidence) {
    return {
      kind: 'accept',
      evidence: contextEvidence,
      reason: `Règle: le document officiel mentionne explicitement ${contextEvidence}.`,
    };
  }

  // A broad IT label may hide a development option in the official decision PDF.
  // Keep it ambiguous until the scraper has had a chance to inspect that document.
  if (GENERIC_IT_PATTERN.test(primary)) {
    return {
      kind: 'ambiguous',
      reason: 'Mention informatique générique, à vérifier dans le document officiel.',
    };
  }

  if (ALL_SPECIALTIES_PATTERN.test(normalizeText(input.specialties))) {
    return {
      kind: 'reject',
      reason: 'Règle: « Toutes les spécialités » ne constitue pas une preuve de développement web ou logiciel.',
    };
  }

  if (AMBIGUOUS_SOFTWARE_PATTERN.test(primary)) {
    return {
      kind: 'ambiguous',
      reason: 'Vocabulaire logiciel potentiellement pertinent, à confirmer avec le contexte détaillé.',
    };
  }

  return {
    kind: 'reject',
    reason: 'Règle: aucune mention explicite de développement web ou logiciel.',
  };
}

export function isAdmissibleAiEvidence(
  candidate: ClassificationCandidate,
  evidence: string,
  officialDocumentText = ''
): boolean {
  const normalizedEvidence = normalizeText(evidence);
  if (!normalizedEvidence || ALL_SPECIALTIES_PATTERN.test(normalizedEvidence)) return false;

  const input = getClassificationInput(candidate);
  const source = normalizeText(
    [input.title, input.specialties, input.diplomas, input.context, officialDocumentText].filter(Boolean).join(' | ')
  );

  return source.includes(normalizedEvidence) && AMBIGUOUS_SOFTWARE_PATTERN.test(normalizedEvidence);
}

export async function classificationContentHash(candidate: ClassificationCandidate): Promise<string> {
  const input = getClassificationInput(candidate);
  // Context is intentionally excluded: it is fetched only for new or stale ambiguous listings.
  const stableInput = JSON.stringify({
    title: normalizeText(input.title),
    organization: normalizeText(input.organization),
    specialties: normalizeText(input.specialties),
    diplomas: normalizeText(input.diplomas),
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableInput));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
