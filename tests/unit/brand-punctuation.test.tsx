import { describe, expect, it, vi } from 'vitest'
import { productNameProblem } from '@domain/brand'
import { docsLibrary } from '@/lib/docs'

/*
  The app built with a name that holds YAML and replacement-pattern characters
  (CL_PRODUCT_NAME): every help page is still there, and the name reads exactly as set.
*/

const other = vi.hoisted(() => {
  const name = 'Acme: Ledger #1 $&'
  vi.stubEnv('CL_PRODUCT_NAME', name)
  return name
})

describe('the app with a punctuated product name', () => {
  it('is a name the setting accepts', () => {
    expect(productNameProblem(other)).toBeNull()
  })

  it('keeps every help page, with the name exactly as set in its title', () => {
    const pages = docsLibrary().pages
    expect(pages.length).toBe(13)
    expect(pages.find((page) => page.slug === 'what-is-heed')?.title).toBe(`What is ${other}`)
  })
})
