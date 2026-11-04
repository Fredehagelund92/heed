import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { repoRoot } from '../lib/pages.ts'
import { tokensCss } from '../lib/tokens.ts'

const source = readFileSync(join(repoRoot, 'src/web/styles/tokens.css'), 'utf8')

describe('the tokens for the site', () => {
  it("are the web app's, in light and dark", () => {
    const css = tokensCss(source)
    const [light, dark] = css.split('@media not print')
    expect(light).toContain('--primary: #2c5dbd;')
    expect(light).toContain("--font-sans: 'Nunito Sans Variable'")
    expect(light).toContain('--radius-frame: 0px;')
    expect(dark).toContain("[data-theme='dark']")
    expect(dark).toContain('--primary: #7aa2f0;')
  })

  it('carry no Tailwind syntax into the stylesheet', () => {
    expect(tokensCss(source)).not.toMatch(/@theme|@utility/)
  })

  it('stop the build when a name the theme reads is gone', () => {
    expect(() => tokensCss(source.replace('--primary:', '--primary-renamed:'))).toThrow(
      'tokens.css has no primary',
    )
  })
})
