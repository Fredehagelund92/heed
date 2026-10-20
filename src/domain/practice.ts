/**
 * The practice domain (`db/seed/practice.ts`): an invented bakery's kiosks, clearly labelled, to
 * learn and show the workflow on. Its id is fixed, so Heed recognises it wherever it is seeded.
 */
export const PRACTICE_AREA = 'practice'

/**
 * How the assistant speaks of a domain of example content: the practice domain, or the demo
 * domain a demo database flags (Sandbox). Their names and summaries say they are invented, which
 * is right for a label, but a pilot user who hears an answer is about "invented terms" hears that
 * Heed made something up. So their content is named for what it is for.
 */
export function exampleWords(kind: 'practice' | 'demo'): string {
  return `Example content to learn on, not real data: call its items and terms the ${kind} examples or the ${kind} example terms, and never call them invented.`
}
