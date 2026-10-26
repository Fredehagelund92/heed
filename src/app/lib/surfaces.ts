// The conversational input surface: the comment box's composer and the Ask composer share it, so
// they are one thing, not two copies. Soft corners (the surface radius), the field border at rest
// (it keeps 3:1, since the edge is what says "type here"), a gentle step on hover, and a calm focus:
// the ring colour on the border plus a faint 3px ring, never an ink outline. Marked important, since
// the editor's own stylesheet sets a border and radius on its root outside Tailwind's layers.
export const inputSurface =
  'rounded-surface! border! border-input! bg-background transition-[border-color,box-shadow] hover:border-foreground/45! focus-within:border-ring! focus-within:ring-3 focus-within:ring-ring/25'
