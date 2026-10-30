import * as z from 'zod/mini'

/**
 * The app's addresses and their search params, one schema per place (routes/). Every param is
 * optional, so an address carries only what someone chose. A value a page does not know is dropped
 * instead of failing the page, as the mockup ignored it. The router merges what a schema returns
 * over the raw params, so a dropped key comes back as `undefined` and its raw value never reaches
 * a page.
 */
function lenient<S extends z.ZodMiniObject>(schema: S) {
  return (raw: Record<string, unknown>): z.output<S> => {
    const result = z.safeParse(schema, raw)
    let parsed: Record<string, unknown>
    if (result.success) parsed = result.data
    else {
      const invalid = new Set(result.error.issues.map((issue) => String(issue.path[0])))
      parsed = z.parse(
        schema,
        Object.fromEntries(Object.entries(raw).filter(([key]) => !invalid.has(key))),
      )
    }
    const dropped = Object.fromEntries(
      Object.keys(schema.def.shape)
        .filter((key) => key in raw && !(key in parsed))
        .map((key) => [key, undefined]),
    )
    return { ...dropped, ...parsed } as z.output<S>
  }
}

const text = z.optional(z.string())
const digits = z.optional(z.string().check(z.regex(/^\d+$/)))
const oneOf = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.optional(z.enum(values))

/** Any address, the documentation and sign-in too: the theme for a screenshot, a demo world, an overlay. */
export const rootSearch = lenient(
  z.object({
    theme: oneOf(['dark', 'light']),
    demo: oneOf(['setup', 'done', 'week', 'last']),
    open: oneOf(['palette', 'connect', 'shortcuts', 'report', 'search']),
  }),
)

/**
 * Every page inside the app: the dock and what its peeks show, the review flags that put a page in
 * a state (?state=, ?slow=1, ?bulk=fail) and the menus and popovers that open from a link.
 */
export const shellSearch = lenient(
  z.object({
    // An old peek's `fact` stays until the root route renames it to `context` (lib/router.ts).
    dock: z.optional(
      z.string().check(z.regex(/^(review|context|fact|def|ask|try|topic|share|where)(\..+)?$/)),
    ),
    flag: text,
    ptab: oneOf(['overview', 'steps', 'warnings']),
    when: text,
    wn: digits,
    links: oneOf(['on', 'off']),
    figures: text,
    state: text,
    slow: oneOf(['1']),
    statehelp: oneOf(['1']),
    menu: oneOf(['help']),
    done: digits,
    connect: text,
    bulk: oneOf(['fail']),
  }),
)

/** An agent's sign-in waiting for the person's answer: the id the login server put in the address. */
export const connectApproveSearch = lenient(
  z.object({ request: z.optional(z.string().check(z.regex(/^[A-Za-z0-9_-]{43}$/))) }),
)

export const inboxSearch = lenient(
  z.object({ tab: oneOf(['all']), card: text, decide: oneOf(['fail']) }),
)

export const askSearch = lenient(
  z.object({ example: text, chat: text, n: text, setup: text, q: text }),
)

export const contextSearch = lenient(
  z.object({ domain: text, due: text, status: oneOf(['archived']) }),
)

/** A new context item starts from a draft, a gap or a metric and market; setup leads back to the Inbox. */
export const contextEditorSearch = lenient(
  z.object({ draft: text, gap: text, metric: text, market: text, dates: text, setup: text }),
)

export const definitionsSearch = lenient(z.object({ domain: text, setup: text }))

export const definitionEditorSearch = lenient(z.object({ sameAs: text }))

export const settingsSearch = lenient(z.object({ step: digits, setup: text, person: text }))

export const observabilitySearch = lenient(
  z.object({
    range: digits,
    domain: text,
    agent: text,
    group: oneOf(['none', 'domain', 'metric']),
    sort: text,
    view: text,
    quality: text,
    answer: text,
    gap: text,
    month: text,
    period: oneOf(['month', 'quarter']),
  }),
)

export const helpSearch = lenient(z.object({ q: text }))

export const docsSearch = lenient(z.object({ q: text }))
