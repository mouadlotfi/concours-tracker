import { normalizeText } from './normalize';

/** Bac+N level for each diploma label wadifa publishes; Doctorat, Bac and Qualification are deliberately absent. */
const LEVEL_PATTERNS: Array<[number, RegExp]> = [
  [5, /\b(?:master|ingenieur|architecte|bac\s*\+\s*5)\b/],
  [3, /\b(?:licence|bac\s*\+\s*3)\b/],
  [2, /\b(?:technicien|technologie|dts|bts|dut|deug|deust|bac\s*\+\s*2)\b/],
];

/**
 * Every level the diploma text accepts. A listing can name several diplomas
 * ("Licence ou Master"), so this returns a set rather than one value.
 */
export function diplomaLevels(text: string | undefined): number[] {
  const normalized = normalizeText(text || '');
  return LEVEL_PATTERNS.filter(([, pattern]) => pattern.test(normalized)).map(([level]) => level);
}
