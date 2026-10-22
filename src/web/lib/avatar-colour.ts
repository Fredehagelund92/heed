/** How many soft tints the avatar palette holds (`--avatar-1-bg` to `--avatar-8-bg` in tokens.css). */
export const avatarPaletteSize = 8

/**
 * The hash seed. Any seed is a fair spread; this one also gives the nine people of the demo
 * workspace seven different tints with no two neighbours alike, so its screens read well.
 */
const seed = 7

/**
 * The palette slot of a person, 1 to 8, from their stable id (FNV-1a with a final mix, so ids
 * that differ in one character still land apart), so the same person is the same colour on every
 * screen and after a rename. A person without an id yet (a name typed into a comment) falls back
 * to the text it is given.
 */
export function avatarSlot(key: string): number {
  let hash = seed
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  hash ^= hash >>> 16
  return ((hash >>> 0) % avatarPaletteSize) + 1
}
