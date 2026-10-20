/*
  The anchor GitHub gives a Markdown heading, so a link to a heading of a help page works on
  GitHub, in the app's Docs area and in what search_help returns (help-pages.ts).
*/

/**
 * A heading's anchor as GitHub makes it: lower case, punctuation dropped, spaces as hyphens.
 */
export function headingSlug(text: string): string {
  // github-slugger's rule: keep letters, marks, numbers, connectors, spaces and hyphens.
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-')
}

/** Hands out the anchors of one page's headings in order: a repeat gets `-1`, `-2`, as on GitHub. */
export function headingIds(): (text: string) => string {
  const seen = new Map<string, number>()
  return (text) => {
    const slug = headingSlug(text)
    const count = seen.get(slug) ?? 0
    seen.set(slug, count + 1)
    return count === 0 ? slug : `${slug}-${count}`
  }
}
