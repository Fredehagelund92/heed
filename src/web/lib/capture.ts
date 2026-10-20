import { limits } from '@domain/proposal-rules'
import { captureParams } from '@/lib/capture-quote'

export { captureParams, captureQuote } from '@/lib/capture-quote'

/*
  Capture from anywhere (UX opportunities, C2): a link that opens Add context with the page a
  person is reading and a sentence they selected on it, ready as the source. Nothing changes on
  the service: the address carries the two values, the form fills them in, and the person checks
  them before anything is saved. A bookmarklet makes that link from any page.

  The page and the sentence come from somewhere else, so they are data only: the link must be
  http or https, the sentence is cleaned and cut to the quote's length, and both are only ever
  shown in the form's own fields (React escapes them), never run or read as instructions.
*/

/**
 * The bookmarklet: on any page it opens Add context in a new tab with the page's address and the
 * selected text, cut the way `captureQuote` cuts it so the address stays short. `noopener` keeps
 * the two pages apart: neither can reach the other.
 */
export function captureBookmarklet(origin: string): string {
  const target = JSON.stringify(new URL('/library/new', origin).href)
  const code = [
    `var u=new URL(${target});`,
    `u.searchParams.set('${captureParams.url}',location.href.slice(0,${limits.url}));`,
    "var s=String(getSelection()).replace(/[\\u202A-\\u202E\\u2066-\\u2069]/g,'').replace(/\\s+/g,' ').trim();",
    `s=Array.from(s).slice(0,${limits.quote}).join('').trim();`,
    `if(s)u.searchParams.set('${captureParams.quote}',s);`,
    "open(u.href,'_blank','noopener');",
  ].join('')
  return `javascript:(function(){${code}})()`
}
