import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PRODUCT_NAME } from '@domain/brand'
import { updateAdvice } from '@/api/api-version'
import { Logo } from '@/components/app-shell/logo'
import { Page } from '@/components/page/page'
import { SignInChoices, SignInIntro } from '@/components/sign-in/sign-in-form'
import { productName } from '@/lib/brand'
import { askHeedFirst } from '@/lib/connect'
import { blocksText, docPicture, docsLibrary } from '@/lib/docs'

/*
  The app built with another product name (CL_PRODUCT_NAME, docs/rename-checklist.md): set
  before any module loads, as a build sets it. The screens, the help pages and their pictures say
  the new name where a sentence names the product, and the old name nowhere. Every other string is
  either free of the name or reads it from the same setting (the brand/no-product-name lint rule).
*/

const other = vi.hoisted(() => {
  const name = 'Acme Ledger'
  vi.stubEnv('CL_PRODUCT_NAME', name)
  return name
})
const old = new RegExp(`\\b${DEFAULT_PRODUCT_NAME}\\b`)

describe('the app with another product name', () => {
  it('reads the name from the setting', () => {
    expect(productName).toBe(other)
  })

  it('says it on the sign-in page, in the logo and in the page title', () => {
    const { container } = render(
      <>
        <SignInIntro />
        <SignInChoices people={[]} onSignIn={() => undefined} />
        <Logo />
        <Page title="Docs" />
      </>,
    )
    expect(screen.getByRole('heading', { name: `Sign in to ${other}` })).toBeVisible()
    expect(screen.getByRole('img', { name: other })).toBeVisible()
    expect(container).toHaveTextContent(`This install of ${other} has no sign-in set up`)
    expect(document.title).toBe(`Docs - ${other}`)
    expect(container.textContent).not.toMatch(old)
    expect(document.title).not.toMatch(old)
  })

  it('says it in the lines an agent is given, and the update advice needs no name', () => {
    // The line for an instructions file is the one the MCP server shares: it names the tool, as
    // the Heed v1 mockup writes it, and no product. The line for a data tool names the product.
    expect(askHeedFirst[0].text).toContain('get_context')
    expect(askHeedFirst[1].text).toContain(other)
    expect(askHeedFirst.map((line) => `${line.where} ${line.text}`).join(' ')).not.toMatch(old)
    expect(updateAdvice('page')).toBe(
      'The app was updated. Reload the page to use the new version.',
    )
  })

  it('puts it in every help page, its front matter and its pictures, and never the old name', () => {
    const pages = docsLibrary().pages
    expect(pages.find((page) => page.slug === 'what-is-heed')?.title).toBe(`What is ${other}`)
    for (const page of pages) {
      const text = [
        page.title,
        page.shortTitle,
        page.summary,
        page.forWhom,
        blocksText(page.oneMinute ?? []),
        blocksText(page.blocks),
      ].join('\n')
      expect(text, page.slug).not.toMatch(old)
    }
    expect(pages.some((page) => blocksText(page.blocks).includes(other))).toBe(true)
    const plug = docPicture('docs/help/images/mcp-plug.svg')
    expect(plug).toContain(`>${other}<`)
    for (const name of ['heed-loop', 'mcp-plug', 'mcp-one-question', 'item-life', 'editions-line'])
      expect(docPicture(`docs/help/images/${name}.svg`), name).not.toMatch(old)
  })
})
