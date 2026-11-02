// The conversational input surface: the comment box's composer and the Ask composer share it, so
// they are one thing, not two copies. Soft corners, the field border at rest (it keeps 3:1, since
// the edge is what says "type here"), a gentle step on hover, and a calm focus: the ring colour on
// the border plus a faint 3px ring, never an ink outline. Marked important, since the editor's own
// stylesheet sets a border and radius on its root outside Tailwind's layers.
const surface =
  'border! border-input! bg-background transition-[border-color,box-shadow] hover:border-foreground/45! focus-within:border-ring! focus-within:ring-3 focus-within:ring-ring/25'

/** The comment box: the surface radius, as a question's bubble. */
export const inputSurface = `rounded-surface! ${surface}`

/** The Ask composer, the one box a chat is typed in: the composer radius, a step softer. */
export const composerSurface = `rounded-composer! ${surface}`
