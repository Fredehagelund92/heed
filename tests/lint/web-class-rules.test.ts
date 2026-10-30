import { describe, expect, it } from 'vitest'
import { appClassRules } from '../../eslint.class-rules.js'

/**
 * The class rules of the new web app (eslint.class-rules.js, `appClassRules`), against samples:
 * every class in the first list must be flagged by its rule, and no rule may flag a class in the
 * second. The second list is the mockup's scales, which design contract v2 allows: half steps,
 * margins, Tailwind's text sizes, weights 400 to 700, and the tokens by name.
 */

const mustFlag: [string, string][] = [
  // Arbitrary values outside the allowlist (contract 2.4)
  ['text-[13px]', 'arbitrary-value'],
  ['p-[13px]', 'arbitrary-value'],
  ['md:w-[280px]', 'arbitrary-value'],
  ['data-[state=open]:p-[13px]', 'arbitrary-value'],
  ['[&_svg]:size-[18px]', 'arbitrary-value'],
  ['bg-[#fff]', 'arbitrary-value'],
  ['dark:text-[oklch(0.8_0.13_75)]', 'arbitrary-value'],
  ['bg-[color-mix(in_oklab,var(--muted)_45%,var(--background))]', 'arbitrary-value'],
  ['h-[calc(100dvh-56px)]', 'arbitrary-value'],
  ['grid-cols-[minmax(0,1fr)_auto]', 'arbitrary-value'],
  ['rounded-[3px]', 'arbitrary-value'],
  ['transition-[width_200ms]', 'arbitrary-value'],
  ['[mask-image:linear-gradient(#000,transparent)]', 'arbitrary-property'],
  ['[scrollbar-width:none]', 'arbitrary-property'],
  ['hover:[--x:3px]', 'arbitrary-property'],
  // Raw palette colours (contract 2.1)
  ['bg-red-500', 'raw-colour'],
  ['text-white', 'raw-colour'],
  ['bg-black/10', 'raw-colour'],
  ['dark:bg-green-950', 'raw-colour'],
  ['decoration-green-700/50', 'raw-colour'],
  // Layers by name (contract 2.5)
  ['z-50', 'numeric-z'],
  ['focus-visible:z-10', 'numeric-z'],
  ['z-[60]', 'numeric-z'],
  ['-z-10', 'numeric-z'],
  // Weights 400 to 700 (contract 2.3)
  ['font-light', 'font-weight'],
  ['font-black', 'font-weight'],
  ['hover:font-extrabold', 'font-weight'],
  // Motion (docs/design/motion.md, "Banned")
  ['duration-300', 'raw-motion'],
  ['delay-150', 'raw-motion'],
  ['duration-[220ms]', 'raw-motion'],
  ['transition-all', 'transition-all'],
  ['hover:transition-all', 'transition-all'],
  ['ease-in', 'easing'],
  ['ease-linear', 'easing'],
  ['ease-[cubic-bezier(0.4,0,1,1)]', 'easing'],
  ['scale-0', 'scale-from-nothing'],
  ['data-closed:scale-y-0', 'scale-from-nothing'],
  ['motion-reduce:transition-none', 'reduced-motion-override'],
  ['motion-reduce:shimmer-none', 'reduced-motion-override'],
  ['animate-[bounce_1s_infinite]', 'own-keyframes'],
  ['animate-[wiggle_200ms]', 'own-keyframes'],
  // Viewport variants inside the dock (contract 3.6); eslint.config.js applies it there only
  ['md:flex', 'viewport-variant'],
  ['max-sm:hidden', 'viewport-variant'],
  ['dark:lg:hidden', 'viewport-variant'],
  ['min-[60rem]:grid', 'viewport-variant'],
]

const mustNotFlag = `
  p-4 px-2.5 py-1.5 gap-1.5 gap-x-5 pt-0.5 mt-4 -mt-2 mx-auto ml-1 space-y-4 p-5 py-px
  size-4 h-2.5 w-20 max-w-96 min-w-0 w-full w-1/2 h-bar h-tool p-bar max-w-sheet max-w-wide max-w-reading
  text-xs text-sm text-base text-lg text-xl text-2xl text-3xl text-xs/relaxed md:text-xl
  font-normal font-medium font-semibold font-bold
  bg-primary text-primary-foreground text-muted-foreground border-input ring-ring/50
  bg-mark-add decoration-mark-del-line text-ok text-warn bg-idle bg-chip text-chip-foreground
  bg-[var(--mark-add)] decoration-[var(--mark-del-line)] max-w-(--container-sheet)
  rounded-frame rounded-surface rounded-md rounded-lg rounded-none
  z-base z-raised z-header z-overlay focus-visible:z-raised z-skip
  transition-colors transition-opacity transition-[width] transition-[border-color,box-shadow]
  duration-(--dur-2) delay-(--dur-3) ease-out ease-move ease-panel ease-in-out
  animate-[countdown_2.6s_linear_forwards] animate-[readfill_1s_linear_forwards] animate-spin
  animate-in fade-in-0 slide-in-from-top-1 motion-reduce:animate-none scale-95 scale-100
  [&_svg]:size-4 data-open:bg-accent data-[side=left]:p-4 group-data-[collapsible=icon]:hidden
  has-[>svg]:px-3 aria-[sort=ascending]:text-foreground @md:flex @min-[60rem]:grid
  [--cell-size:--spacing(8)] [--cell-radius:var(--radius-md)] p-0! sr-only truncate
`
  .split(/\s+/)
  .filter(Boolean)

const flaggedBy = (name: string) =>
  appClassRules.filter((rule) => new RegExp(rule.pattern).test(name)).map((rule) => rule.id)
/** Outside the dock, where eslint.config.js leaves viewport variants to the page. */
const outsideDock = (name: string) => flaggedBy(name).filter((id) => id !== 'viewport-variant')

describe('class rules of the new app (design contract v2)', () => {
  it.each(mustFlag)('flags %s with %s', (name, rule) => {
    if (rule === 'viewport-variant') expect(flaggedBy(name)).toContain(rule)
    else expect(outsideDock(name)).toEqual([rule])
  })

  it.each(mustNotFlag)('accepts %s', (name) => {
    expect(outsideDock(name)).toEqual([])
  })

  it('lets the dock read its container', () => {
    for (const name of ['@md:flex', '@min-[60rem]:grid', '@2xl/main:min-h-44', 'dark:bg-muted'])
      expect(flaggedBy(name), name).toEqual([])
  })

  it('has samples for every rule', () => {
    const sampled = new Set(mustFlag.map(([, rule]) => rule))
    expect(appClassRules.map((rule) => rule.id).filter((id) => !sampled.has(id))).toEqual([])
  })

  it('names the fix in every message', () => {
    for (const rule of appClassRules) expect(rule.message).toMatch(/\$0/)
  })
})
