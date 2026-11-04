/** "customs.example": a link's host, the way a link chip names it; a source that is no link stays as written. */
export const hostOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, '') || url
  } catch {
    return url.replace(/^https?:\/\//, '')
  }
}
