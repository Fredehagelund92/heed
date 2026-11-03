import type { DevPerson } from './modules/auth/index.ts'

/**
 * What the Vercel bundle (scripts/vercel-build.ts) carries in place of the files a function cannot
 * read beside its code: Heed's version from package.json, and the picker's people from
 * HEED_DEV_PEOPLE_FILE. esbuild writes their JSON in where HEED_BUNDLE stands. Everywhere else it
 * is undefined, and both are read from their files.
 */
declare const HEED_BUNDLE: string | undefined

export const bundled =
  typeof HEED_BUNDLE === 'undefined'
    ? undefined
    : (JSON.parse(HEED_BUNDLE) as { version: string; people: DevPerson[] })
