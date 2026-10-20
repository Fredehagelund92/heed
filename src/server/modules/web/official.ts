/*
  Official sources: a government, a parliament or a court publishing its own text. Searches list
  them first and the assistant prefers them, because a law's own words beat a news report of it
  (a report can quote a measure that has since lapsed). A host is official when its name ends in
  a government domain; the list is short on purpose and says nothing about whether a page is right.
*/

const officialHosts: RegExp[] = [
  // gov, gov.br, gov.uk, gob.mx, gouv.fr, govt.nz, go.jp and the like.
  /(?:^|\.)(?:gov|gob|gouv|govt|go)\.[a-z]{2}$/,
  /(?:^|\.)(?:gov|mil)$/,
  // Legislatures, courts and public prosecutors under .br.
  /(?:^|\.)(?:leg|jus|mp)\.br$/,
  // The European Union, Germany's federal government, Switzerland, Austria and Canada.
  /(?:^|\.)europa\.eu$/,
  /(?:^|\.)bund\.de$/,
  /(?:^|\.)admin\.ch$/,
  /(?:^|\.)gv\.at$/,
  /(?:^|\.)gc\.ca$/,
]

/** Whether an address is on an official host. */
export function isOfficial(address: string): boolean {
  const url = URL.parse(address)
  if (!url) return false
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  return officialHosts.some((pattern) => pattern.test(host))
}
