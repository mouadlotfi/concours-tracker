import { describe, expect, test } from 'bun:test';

import {
  CLASSIFIER_VERSION,
  classificationContentHash,
  classifyByRules,
  isAdmissibleAiEvidence,
  type ClassificationCandidate,
} from './classification';

function candidate(overrides: Partial<ClassificationCandidate> = {}): ClassificationCandidate {
  return {
    id: 'fixture',
    title: 'Concours de recrutement',
    details: {
      'Administration qui recrute': 'Administration de test',
      'Spécialités requises': '',
      'Diplômes': '',
    },
    ...overrides,
  };
}

describe(`classifier ${CLASSIFIER_VERSION}`, () => {
  test('rejects the reported financial planning concours', () => {
    const result = classifyByRules(candidate({
      id: '95314',
      title: 'Concours de recrutement de 1 Responsable planification & pilotage',
      details: {
        'Administration qui recrute': 'Caisse de Dépôt et de Gestion',
        'Spécialités requises': 'Toutes les spécialités',
        'Diplômes': 'Spécialités requises : Toutes les spécialités',
      },
      classificationContext: 'Planification financière, contrôle de gestion, valorisation et outils BI.',
    }));

    expect(result.kind).toBe('reject');
    expect(result.reason).toContain('management');
  });

  test('rejects a development department director before accepting development wording', () => {
    const result = classifyByRules(candidate({
      id: '95319',
      title: 'Directeur du Pôle Développement Informatique et Intelligence Artificielle',
      details: { 'Spécialités requises': 'Développement informatique' },
    }));

    expect(result.kind).toBe('reject');
    expect(result.reason).toContain('management');
  });

  test('accepts explicit software engineering evidence in the title', () => {
    const result = classifyByRules(candidate({
      title: "Ingénieur d'état en informatique, option génie logiciel",
      details: { 'Spécialités requises': 'Toutes les spécialités' },
    }));

    expect(result.kind).toBe('accept');
  });

  test('accepts explicit computer-development specialties', () => {
    const result = classifyByRules(candidate({
      details: { 'Spécialités requises': 'Techniques de développement informatique' },
    }));

    expect(result.kind).toBe('accept');
  });

  test('holds generic informatique for official-document inspection', () => {
    const result = classifyByRules(candidate({
      title: 'Technicien de 3ème grade en génie civil, informatique',
      details: { 'Spécialités requises': 'génie civil informatique' },
    }));

    expect(result.kind).toBe('ambiguous');
  });

  test('accepts explicit development evidence found in an official document', () => {
    const result = classifyByRules(candidate({
      title: 'Technicien de 3ème grade en informatique',
      details: { 'Spécialités requises': 'informatique' },
      classificationContext: 'Option proposée : techniques de développement informatique.',
    }));

    expect(result.kind).toBe('accept');
    expect(result.reason).toContain('document officiel');
  });

  test('accepts Arabic software-development evidence from an official document', () => {
    const result = classifyByRules(candidate({
      title: 'تقني من الدرجة الثالثة في المعلوميات',
      details: { 'Spécialités requises': 'المعلوميات' },
      classificationContext: 'التخصص المطلوب: تطوير البرمجيات وتطبيقات الويب.',
    }));

    expect(result.kind).toBe('accept');
  });

  test('sends genuinely application-oriented wording to AI', () => {
    const result = classifyByRules(candidate({
      title: 'Ingénieur architecture applicative',
      details: { 'Spécialités requises': 'architecture applicative' },
    }));

    expect(result.kind).toBe('ambiguous');
  });

  test('requires relevant AI evidence to be an exact admissible quote', () => {
    const item = candidate({
      title: 'Ingénieur architecture applicative',
      details: { 'Spécialités requises': 'conception des applications métiers' },
    });

    expect(isAdmissibleAiEvidence(item, 'applications métiers')).toBe(true);
    expect(isAdmissibleAiEvidence(item, 'développement web')).toBe(false);
    expect(isAdmissibleAiEvidence(item, 'développement web', 'Option développement web')).toBe(true);
    expect(isAdmissibleAiEvidence(item, 'تطوير البرمجيات', 'التخصص: تطوير البرمجيات')).toBe(true);
    expect(isAdmissibleAiEvidence(item, 'Toutes les spécialités')).toBe(false);
  });

  test('content hashes are stable and change with classification inputs', async () => {
    const original = candidate({
      title: 'Ingénieur architecture applicative',
      details: { 'Spécialités requises': 'architecture applicative' },
    });
    const changed = candidate({
      ...original,
      details: { 'Spécialités requises': 'génie logiciel' },
    });

    expect(await classificationContentHash(original)).toBe(await classificationContentHash(original));
    expect(await classificationContentHash(original)).not.toBe(await classificationContentHash(changed));
  });
});
