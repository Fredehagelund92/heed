/**
 * The product's name, decided in one place (docs/rename-checklist.md). People and agents see it
 * only where it earns its place: a sentence that names the product, never a label such as Back
 * or Add context. The web app (src/app/lib/brand.ts) and the service (src/server/brand.ts) read
 * one setting, `CL_PRODUCT_NAME`, once at start, so the assistant's instructions stay
 * byte-stable; this module holds the default and the rules, and does no I/O.
 *
 * Technical names that carry the current name (the CLI command, the MCP server id, package names,
 * environment variables, storage keys, file names) do not come from here: renaming them is a
 * migration of its own, planned in the checklist.
 */

/** The public repository: Edit on GitHub, links to its documents and the demo model's files. */
export const REPOSITORY_URL = 'https://github.com/Fredehagelund92/heed'

/** The name when `CL_PRODUCT_NAME` is not set. */
export const DEFAULT_PRODUCT_NAME = 'Heed'

/** The longest name the setting takes: it sits in a title, a heading and a button. */
export const PRODUCT_NAME_MAX = 32

/** Why a value cannot be the product's name, or null when it can. */
export function productNameProblem(value: string): string | null {
  const name = value.trim()
  if (!name) return 'Give the product a name, or leave the setting out for the default.'
  if (name.length > PRODUCT_NAME_MAX) return `Keep the name to ${PRODUCT_NAME_MAX} characters.`
  // eslint-disable-next-line no-control-regex -- the point is to refuse control characters
  if (/[\u0000-\u001f\u007f<>{}]/.test(name))
    return 'Use letters, digits, spaces and punctuation only: no line breaks, angle or curly brackets.'
  return null
}

/** The setting's value as the product's name: the default when it is unset, empty or unusable. */
export function productNameFrom(value: string | undefined): string {
  return value === undefined || productNameProblem(value) ? DEFAULT_PRODUCT_NAME : value.trim()
}

/** The token a help page (docs/old-help) writes where it names the product. */
export const PRODUCT_TOKEN = '{{product}}'

/** A help page's text with the product's name in place of each token. */
export function withProductName(text: string, productName: string): string {
  return text.replaceAll(PRODUCT_TOKEN, () => productName)
}

/**
 * A help page's parsed front matter or body with the product's name in place of each token, in
 * every string it holds. The name goes in after parsing, never through the YAML, so punctuation in
 * a name cannot change what a page says.
 */
export function withProductNameIn<T>(value: T, productName: string): T {
  if (typeof value === 'string') return withProductName(value, productName) as T
  if (Array.isArray(value))
    return value.map((item: unknown) => withProductNameIn(item, productName)) as T
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, withProductNameIn(item, productName)]),
    ) as T
  return value
}
