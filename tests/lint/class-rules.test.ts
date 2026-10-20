import { describe, expect, it } from 'vitest'
import { classRules } from '../../eslint.class-rules.js'

/**
 * The unit test of the class rules, from appendix C of the design contract: every class in the
 * first list must be flagged by its rule, and no rule may flag a class in the second list. The
 * weight samples follow the captain's type decision (Nunito Sans at 400 and 700) rather than the
 * contract's 400, 500 and 600.
 */

const mustFlag: [string, string][] = [
  ['p-[13px]', 'arbitrary-value'],
  ['md:w-[280px]', 'arbitrary-value'],
  ['data-[state=open]:p-[13px]', 'arbitrary-value'],
  ['[&_svg]:size-[18px]', 'arbitrary-value'],
  ['bg-[#fff]', 'arbitrary-value'],
  ['h-[calc(100dvh-56px)]', 'arbitrary-value'],
  ['z-[999]', 'arbitrary-value'],
  ['[mask-image:linear-gradient(#000,transparent)]', 'arbitrary-property'],
  ['hover:[--x:3px]', 'arbitrary-property'],
  ['p-5', 'spacing-off-scale'],
  ['px-2.5', 'spacing-off-scale'],
  ['gap-1.5', 'spacing-off-scale'],
  ['md:gap-10', 'spacing-off-scale'],
  ['py-px', 'spacing-off-scale'],
  ['p-(--gutter)', 'spacing-off-scale'],
  ['gap-x-5', 'spacing-off-scale'],
  ['pt-0.5', 'spacing-off-scale'],
  ['scroll-pt-14', 'spacing-off-scale'],
  ['mt-4', 'margin'],
  ['-mt-2', 'margin'],
  ['mx-2', 'margin'],
  ['ml-1', 'margin'],
  ['lg:mb-6', 'margin'],
  ['space-y-4', 'space-utility'],
  ['space-x-2', 'space-utility'],
  ['text-sm', 'default-text-size'],
  ['md:text-xl', 'default-text-size'],
  ['text-2xl', 'default-text-size'],
  ['bg-red-500', 'raw-colour'],
  ['text-white', 'raw-colour'],
  ['border-gray-200', 'raw-colour'],
  ['hover:bg-black/50', 'raw-colour'],
  ['!p-4', 'important'],
  ['p-4!', 'important'],
  ['w-20', 'size-off-grid'],
  ['h-2.5', 'size-off-grid'],
  ['size-24', 'size-off-grid'],
  ['max-w-96', 'size-off-grid'],
  ['gap-header', 'size-token-as-spacing'],
  ['p-row', 'size-token-as-spacing'],
  ['px-control-md', 'size-token-as-spacing'],
  ['md:flex', 'viewport-variant'],
  ['xl:grid-cols-3', 'viewport-variant'],
  ['max-md:hidden', 'viewport-variant'],
  ['px-gutter', 'gutter-outside-template'],
  ['p-gutter', 'gutter-outside-template'],
  ['gap-gutter', 'gutter-outside-template'],
  ['p-table-header', 'size-token-as-spacing'],
  ['gap-prose', 'size-token-as-spacing'],
  ['md:pl-gutter', 'gutter-outside-template'],
  ['hover:md:flex', 'viewport-variant'],
  ['dark:lg:hidden', 'viewport-variant'],
  ['max-2xl:hidden', 'viewport-variant'],
  ['hover:!p-4', 'important'],
  ['data-[state=open]:[--x:3px]', 'arbitrary-property'],
  ['z-50', 'numeric-z'],
  ['font-medium', 'font-weight'],
  ['font-semibold', 'font-weight'],
  ['hover:font-extrabold', 'font-weight'],
  ['transition-all', 'raw-motion'],
  ['duration-300', 'raw-motion'],
]

const mustNotFlag =
  `p-4 px-3 py-2 pt-0 gap-2 gap-x-4 gap-16 @md:gap-6 hover:p-8 ml-auto mx-auto mt-auto p-1 size-4
  size-5 h-8 w-11 h-row h-table-header w-assistant max-w-prose w-sidebar max-w-reading min-w-0
  w-full h-px w-1/2 text-body text-caption text-dense bg-primary text-muted-foreground
  border-border bg-type-event-tint rounded-md font-normal font-bold transition-colors
  duration-fast z-sticky [&_svg]:size-4 data-open:bg-accent data-[side=left]:p-4
  hover:data-open:bg-accent group-data-[side=left]:flex has-[>svg]:px-3
  aria-[sort=ascending]:text-foreground place-items-center pointer-events-none max-h-dvh min-h-0
  grid-cols-2 order-2 mask-none @md:flex @xl:grid-cols-3 sr-only truncate`
    .split(/\s+/)
    .filter(Boolean)

const flaggedBy = (name: string) =>
  classRules.filter((rule) => new RegExp(rule.pattern).test(name)).map((rule) => rule.id)

describe('class rules (contract 3.3, appendix C)', () => {
  it('has the 61 violating and 58 compliant samples (contract plus the weight decision)', () => {
    expect(mustFlag).toHaveLength(61)
    expect(mustNotFlag).toHaveLength(58)
  })

  it.each(mustFlag)('flags %s with %s', (name, rule) => {
    expect(flaggedBy(name)).toContain(rule)
  })

  it.each(mustNotFlag)('accepts %s', (name) => {
    expect(flaggedBy(name)).toEqual([])
  })

  it('names the fix in every message', () => {
    for (const rule of classRules) expect(rule.message).toMatch(/\$0/)
  })
})
