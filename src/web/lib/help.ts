/*
  Help in context (docs/help/README.md, "Help in context"): the places in the help pages that a
  screen links to with `HelpLink`, where a person stalls. Each is a page's slug, or a slug and a
  heading on it, as a link between pages writes it. The docs check (tests/unit/docs.test.ts)
  fails when one has no page or no such heading, so a help link never opens nothing. Add a
  place here before a screen links to it.
*/

export const helpTargets = [
  // Home
  'what-is-heed',
  // Connect your AI, and Administration › MCP and gateway
  'mcp',
  'glossary#tool',
  'connect-an-agent',
  'connect-an-agent#steps',
  'connect-an-agent#ask-first',
  // Add context and Proposals › Mine
  'add-your-first-context',
  // The review page and Proposals › To review
  'review-a-proposal',
  'glossary#check',
  'glossary#test-question',
  // Health
  'read-health#what-the-numbers-mean',
  'read-health#when-a-run-says-no-clear-change',
  // Editions and the delivery banner
  'editions',
  'editions#what-live-means',
  'editions#the-stop-switch',
  // Gaps
  'glossary#gap',
  'common-questions#why-are-some-counts-hidden',
  // Administration › Domains
  'glossary#domain',
  // Administration › About our business
  'tell-heed-about-your-business',
  // Administration › Sources, adding a connector
  'add-a-connector',
] as const

export type HelpTarget = (typeof helpTargets)[number]

/** A target's page and heading: `glossary#gap` is the heading `gap` on the glossary. */
export function helpPlace(target: HelpTarget): { slug: string; heading: string | undefined } {
  const [slug = '', heading] = target.split('#')
  return { slug, heading }
}
