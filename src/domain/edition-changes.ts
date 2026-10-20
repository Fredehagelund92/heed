/**
 * The kinds of change between two editions, apart from the rest of `editions.ts`, so an address
 * that filters by one (the route's search schema, which the shell loads before any page) does not
 * bring the sentences along.
 */

/**
 * How one item differs between two editions, in the order a page lists them:
 * - `added`: served in the later state and not in the earlier one;
 * - `changed`: another version with different content;
 * - `checked`: "checked, still correct", a new version with the same content and current change
 *   marks (CON-211);
 * - `resaved`: another version whose content is identical ("saved again, nothing different");
 * - `retired`: no longer served, because it was retired or replaced;
 * - `removed`: no longer served, because someone went back to an edition without it, or because
 *   going back would leave it out.
 */
export const editionChangeKinds = [
  'added',
  'changed',
  'checked',
  'resaved',
  'retired',
  'removed',
] as const
export type EditionChangeKind = (typeof editionChangeKinds)[number]
