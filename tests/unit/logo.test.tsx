import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  Logo,
  LogoSymbol,
  LogoWordmark,
  logoBladePath,
  logoBladeTurn,
  logoWordmarkPath,
  logoWordmarkTransform,
} from '@/components/app-shell/logo'

/*
  The Heed logo (docs/design/logo.md): the symbol and the outlined wordmark on one grid, one fill
  of currentColor so it inverts with the theme, and the same paths in every file that draws it
  outside the app.
*/

const publicFile = (name: string) => readFileSync(`src/web/public/${name}`, 'utf8')

describe('the Heed logo', () => {
  it('draws the symbol as one blade and the same blade turned half a turn, in currentColor', () => {
    const { container } = render(<LogoSymbol />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('viewBox', '0 0 36 40')
    expect(svg).toHaveAttribute('fill', 'currentColor')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    const blades = [...(svg?.querySelectorAll('path') ?? [])]
    expect(blades.map((path) => path.getAttribute('d'))).toEqual([logoBladePath, logoBladePath])
    expect(blades.map((path) => path.getAttribute('transform'))).toEqual([null, logoBladeTurn])
    // The half turn is about the grid's centre.
    expect(logoBladeTurn).toBe('rotate(180 18 20)')
    expect(svg?.outerHTML).not.toMatch(/gradient|stroke/)
  })

  it('is 18 by 20 by itself, the sidebar size, and a height class sizes it otherwise', () => {
    const { container } = render(<LogoSymbol />)
    expect(container.querySelector('svg')).toHaveAttribute('width', '18')
    expect(container.querySelector('svg')).toHaveAttribute('height', '20')
    const { container: tall } = render(<LogoSymbol className="h-8" />)
    expect(tall.querySelector('svg')).toHaveClass('h-8', 'w-auto')
  })

  it('cuts the wordmark from the lockup grid: 7 pixels after the symbol, the same height', () => {
    const { container } = render(<LogoWordmark />)
    const svg = container.querySelector('svg')
    // The lockup grid has 2 units to the pixel: the wordmark starts at 36 + 14 units.
    expect(svg).toHaveAttribute('viewBox', '50 0 71 40')
    expect([svg?.getAttribute('width'), svg?.getAttribute('height')]).toEqual(['35.5', '20'])
    expect(svg?.querySelector('path')).toHaveAttribute('d', logoWordmarkPath)
    expect(svg?.querySelector('path')).toHaveAttribute('transform', logoWordmarkTransform)
    // Outlines, not text: no webfont, and the logo cannot fall back to another typeface.
    expect(svg?.querySelector('text')).toBeNull()
  })

  it('is one image named Heed as a lockup, 20 high by itself', () => {
    render(<Logo />)
    const lockup = screen.getByRole('img', { name: 'Heed' })
    expect(lockup).toHaveAttribute('viewBox', '0 0 121 40')
    expect(lockup).toHaveAttribute('height', '20')
    expect(lockup).toHaveAttribute('fill', 'currentColor')
    const paths = [...lockup.querySelectorAll('path')].map((path) => path.getAttribute('d'))
    expect(paths).toEqual([logoBladePath, logoBladePath, logoWordmarkPath])
  })

  it('draws the same paths in the public files and the favicon', () => {
    const symbol = `<path d="${logoBladePath}"/><path transform="${logoBladeTurn}" d="${logoBladePath}"/>`
    for (const file of ['heed-symbol.svg', 'heed-mark.svg']) {
      expect(publicFile(file)).toContain('viewBox="0 0 36 40"')
      expect(publicFile(file)).toContain(symbol)
    }
    const lockup = publicFile('heed-lockup.svg')
    expect(lockup).toContain('viewBox="0 0 121 40"')
    expect(lockup).toContain(symbol)
    expect(lockup).toContain(`transform="${logoWordmarkTransform}" d="${logoWordmarkPath}"`)
    const favicon = publicFile('favicon.svg')
    expect(favicon).toContain(symbol)
    // A light symbol on an ink tile in every colour scheme, so it shows on any tab strip.
    expect(favicon).toContain('<rect width="32" height="32" rx="7" fill="#13161d"/>')
    expect(favicon).toContain('<g fill="#f4f5f8"')
    expect(favicon).not.toMatch(/prefers-color-scheme|<style/)
  })

  it('links the icons with a version, so browsers drop a cached old icon', () => {
    const head = readFileSync('src/web/index.html', 'utf8')
    for (const file of ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png']) {
      expect(head).toContain(`href="/${file}?v=`)
    }
  })
})
