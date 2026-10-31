import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/*
  The notes of a GitHub Release (.github/workflows/release.yml, docs/releasing.md):

    node scripts/release-notes.ts <version> <owner/repo> service=<image@digest> web=<image@digest>

  prints them. They are what the release is for (while Heed is 0.x), the section release-please
  wrote into CHANGELOG.md for that version, and the two images with their digests and how to check
  where they were built. It fails when CHANGELOG.md has no section for the version, so a tag that
  skipped the release pull request never gets a release.
*/

export type ReleaseImage = { role: 'service' | 'web'; name: string; digest: string }

const roles: Record<ReleaseImage['role'], string> = {
  service: 'The service',
  web: 'The web app',
}

/**
 * The body of the CHANGELOG.md section for `version`, without its heading, or undefined when
 * there is none. release-please heads a section `## [0.2.0](compare link) (date)`, and the first
 * release `## 0.1.0 (date)`.
 */
export function changelogSection(changelog: string, version: string): string | undefined {
  const lines = changelog.split('\n')
  const heading = new RegExp(`^## \\[?${version.replaceAll('.', '\\.')}\\]?(?:[ (]|$)`)
  const start = lines.findIndex((line) => heading.test(line))
  if (start < 0) return undefined
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function releaseNotes({
  version,
  repository,
  changelog,
  images,
}: {
  version: string
  repository: string
  changelog: string
  images: readonly ReleaseImage[]
}): string {
  const section = changelogSection(changelog, version)
  if (section === undefined)
    throw new Error(
      `CHANGELOG.md has no section for ${version}. Tag the commit that merged the release pull request (docs/releasing.md).`,
    )
  const tag = `v${version}`
  const [first] = images
  return [
    ...(version.startsWith('0.')
      ? [
          `Heed ${version.split('.').slice(0, 2).join('.')} is for trying Heed on one computer. It is not ready for production use. To run it, follow the [Quick start](https://github.com/${repository}/blob/${tag}/README.md#quick-start) at this tag.`,
          '',
        ]
      : []),
    section || 'No change people notice.',
    '',
    '## Images',
    '',
    'Each is built for linux/amd64 and linux/arm64, with an SBOM and the build provenance.',
    '',
    '| Image | Pull | Digest |',
    '| --- | --- | --- |',
    ...images.map(
      (image) => `| ${roles[image.role]} | \`${image.name}:${version}\` | \`${image.digest}\` |`,
    ),
    ...(first
      ? [
          '',
          'Check that an image was built by this repository, from this tag:',
          '',
          '```sh',
          `gh attestation verify oci://${first.name}:${version} --repo ${repository}`,
          '```',
        ]
      : []),
    '',
  ].join('\n')
}

/** `service=ghcr.io/owner/heed@sha256:...` as an image. */
export function parseImage(argument: string): ReleaseImage {
  const match = /^(service|web)=([^@\s]+)@(sha256:[0-9a-f]{64})$/.exec(argument)
  const [, role, name, digest] = match ?? []
  if ((role !== 'service' && role !== 'web') || !name || !digest)
    throw new Error(`Not an image: ${argument} (want service=<name>@sha256:<digest>)`)
  return { role, name, digest }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version, repository, ...images] = process.argv.slice(2)
  if (!version || !repository) {
    console.error(
      'Usage: node scripts/release-notes.ts <version> <owner/repo> service=<image@digest> web=<image@digest>',
    )
    process.exitCode = 2
  } else {
    try {
      const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
      process.stdout.write(
        releaseNotes({ version, repository, changelog, images: images.map(parseImage) }),
      )
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    }
  }
}
