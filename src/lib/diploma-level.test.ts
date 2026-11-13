import { expect, test } from 'bun:test';
import { diplomaLevels } from './diploma-level';

// Values taken from the stored D1 rows, plus the variants that must stay unmapped.
const CASES: Array<[string | undefined, number[]]> = [
  ['Diplôme de Technicien', [2]],
  ['Diplôme de Technicien Spécialisé Diplôme Universitaire de Technologie Brevet du Technicien Supérieur', [2]],
  ['diplome de technicien specialise', [2]],
  ['Licence', [3]],
  ['Master', [5]],
  ["Diplôme d Ingénieur d État", [5]],
  ["Diplôme d'Architecte", [5]],
  ['Licence ou Master', [5, 3]],
  ['Doctorat', []],
  ['Doctorat en Médecine Générale', []],
  ['Baccalauréat', []],
  ['Qualification Professionnelle', []],
  ['Spécialités requises : Toutes les spécialités', []],
  ['', []],
  [undefined, []],
];

test('maps the diploma labels wadifa publishes to the tracked levels', () => {
  for (const [text, levels] of CASES) expect(diplomaLevels(text)).toEqual(levels);
});
