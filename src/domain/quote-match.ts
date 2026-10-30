/*
  Whether a quoted sentence is on a page Heed read (the automatic quote match). A page and a
  quote rarely carry the same bytes even when the words are the same: a no-break space where the
  quote has a space, curly quotes where it has straight ones, a soft hyphen, a line break, a word
  in capitals by the page's style. Both sides are reduced to the same plain form first, so a match
  means the words are there in that order. The result is only ever a warning to the person and the
  owner: the owner opening the link is the real check.
*/

/** Spaces of every width, the no-break space among them. */
const spaces = /[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g
/** Soft hyphens, zero-width marks and direction marks: invisible, so never part of the words. */
const invisible = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g

/** Text in the plain form a quote and a page are compared in. */
export function matchForm(text: string): string {
  return text
    .normalize('NFC')
    .replace(invisible, '')
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(spaces, ' ')
    .trim()
    .toLowerCase()
}
