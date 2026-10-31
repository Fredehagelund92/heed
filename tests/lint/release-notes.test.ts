import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { changelogSection, parseImage, releaseNotes } from '../../scripts/release-notes.ts'

/*
  The notes of a GitHub Release (scripts/release-notes.ts) are made from the section release-please
  wrote into CHANGELOG.md for the tagged version, in the shape it writes them.
*/

const compare = 'https://github.com/Fredehagelund92/heed/compare'
const changelog = `# Changelog

## [0.2.0](${compare}/v0.1.0...v0.2.0) (2026-11-14)


### Features

* **web:** sort every list both ways ([#120](https://github.com/Fredehagelund92/heed/issues/120)) ([1234567](https://github.com/Fredehagelund92/heed/commit/1234567))


### Fixes

* **ask:** say a question was not looked up ([#121](https://github.com/Fredehagelund92/heed/issues/121)) ([89abcde](https://github.com/Fredehagelund92/heed/commit/89abcde))

## [0.1.10](${compare}/v0.1.9...v0.1.10) (2026-11-10)


### Fixes

* a fix in 0.1.10

## 0.1.0 (2026-10-31)


### Features

* the first release
`

const digest = (character: string) => `sha256:${character.repeat(64)}`
const images = [
  { role: 'service', name: 'ghcr.io/fredehagelund92/heed', digest: digest('a') },
  { role: 'web', name: 'ghcr.io/fredehagelund92/heed-web', digest: digest('b') },
] as const

describe('the CHANGELOG.md section of a version', () => {
  it('is the body under its heading, up to the next version', () => {
    expect(changelogSection(changelog, '0.2.0')).toBe(
      [
        '### Features',
        '',
        '* **web:** sort every list both ways ([#120](https://github.com/Fredehagelund92/heed/issues/120)) ([1234567](https://github.com/Fredehagelund92/heed/commit/1234567))',
        '',
        '### Fixes',
        '',
        '* **ask:** say a question was not looked up ([#121](https://github.com/Fredehagelund92/heed/issues/121)) ([89abcde](https://github.com/Fredehagelund92/heed/commit/89abcde))',
      ].join('\n'),
    )
  })

  it('reads the first release, which has no compare link, and the last section of the file', () => {
    expect(changelogSection(changelog, '0.1.0')).toBe('### Features\n\n* the first release')
  })

  it('names the version exactly: 0.1.1 is not 0.1.10, and a dot is not any character', () => {
    expect(changelogSection(changelog, '0.1.1')).toBeUndefined()
    expect(changelogSection(changelog, '0.1.10')).toBe('### Fixes\n\n* a fix in 0.1.10')
    expect(changelogSection(changelog.replace('0.1.0 (', '0x1y0 ('), '0.1.0')).toBeUndefined()
  })
})

describe('the release notes', () => {
  const notes = releaseNotes({
    version: '0.2.0',
    repository: 'Fredehagelund92/heed',
    changelog,
    images,
  })

  it('say what a 0.x release is for, then list the changes and the images', () => {
    expect(notes).toBe(
      [
        'Heed 0.2 is for trying Heed on one computer. It is not ready for production use. To run it, follow the [Quick start](https://github.com/Fredehagelund92/heed/blob/v0.2.0/README.md#quick-start) at this tag.',
        '',
        changelogSection(changelog, '0.2.0'),
        '',
        '## Images',
        '',
        'Each is built for linux/amd64 and linux/arm64, with an SBOM and the build provenance.',
        '',
        '| Image | Pull | Digest |',
        '| --- | --- | --- |',
        `| The service | \`ghcr.io/fredehagelund92/heed:0.2.0\` | \`${digest('a')}\` |`,
        `| The web app | \`ghcr.io/fredehagelund92/heed-web:0.2.0\` | \`${digest('b')}\` |`,
        '',
        'Check that an image was built by this repository, from this tag:',
        '',
        '```sh',
        'gh attestation verify oci://ghcr.io/fredehagelund92/heed:0.2.0 --repo Fredehagelund92/heed',
        '```',
        '',
      ].join('\n'),
    )
  })

  it('leave the 0.x line out from 1.0 on', () => {
    const one = releaseNotes({
      version: '1.0.0',
      repository: 'Fredehagelund92/heed',
      changelog: '# Changelog\n\n## [1.0.0](x) (2027-01-01)\n\n### Features\n\n* stable\n',
      images,
    })
    expect(one.startsWith('### Features\n\n* stable\n\n## Images\n')).toBe(true)
  })

  it('fail when CHANGELOG.md has no section for the tag', () => {
    expect(() => releaseNotes({ version: '0.3.0', repository: 'o/r', changelog, images })).toThrow(
      'CHANGELOG.md has no section for 0.3.0.',
    )
  })
})

describe('an image argument', () => {
  it('is a role, a name and a sha256 digest', () => {
    expect(parseImage(`web=ghcr.io/o/heed-web@${digest('c')}`)).toEqual({
      role: 'web',
      name: 'ghcr.io/o/heed-web',
      digest: digest('c'),
    })
  })

  it.each([
    `cube=ghcr.io/o/heed@${digest('c')}`,
    'service=ghcr.io/o/heed:0.1.0',
    'service=ghcr.io/o/heed@sha256:short',
  ])('refuses %s', (argument) => {
    expect(() => parseImage(argument)).toThrow('Not an image')
  })
})

describe('the script', () => {
  it('fails and says why when this checkout has no section for the version', () => {
    const run = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../../scripts/release-notes.ts', import.meta.url)), '99.0.0', 'o/r'],
      { encoding: 'utf8' },
    )
    expect(run.status).toBe(1)
    expect(run.stderr).toMatch(/99\.0\.0|no such file/)
  })
})
