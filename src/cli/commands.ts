/**
 * `heed`: the command-line tool for engineers and coding agents (FR-120). It writes through the
 * same API as the web form, so drafts and imports become proposals in the same review queue, and
 * it checks item files and edition exports offline.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { parseArgs } from 'node:util'
import { ORPCError } from '@orpc/client'
import { parse } from 'yaml'
import type { ItemImportReport } from '../contract/index.ts'
import { DEFAULT_WEB_ORIGINS } from '../contract/limits.ts'
import { canonicalJson } from '../domain/canonical.ts'
import type { FormatFinding } from '../domain/draft.ts'
import { type EditionExport, verifyEditionExport } from '../domain/edition-export.ts'
import { offlineFindings, readItemFile } from '../domain/item-file.ts'
import { itemJsonSchema } from '../domain/item-version.ts'
import { createClient, type HeedClient } from './client.ts'
import { operatorInvite } from './invite.ts'

export type Io = {
  stdout(text: string): void
  stderr(text: string): void
  env: Record<string, string | undefined>
  fetch?: typeof globalThis.fetch
}

export const usage = `Usage: heed <command> [options]

Commands that need no service:
  validate <file>     Check an item file (YAML or JSON): format, mention syntax and rows,
                      text that looks sensitive. Scope, vocabulary and mention targets need
                      the live edition: use import, which is a dry run by default.
  schema              Print the JSON Schema of the item format, mentions included.
  verify <file>       Recompute the digests of an edition export.

Commands that use the database directly (the owner's address in DATABASE_URL_MIGRATE):
  invite <email>      Invite someone, and print the link to send them. --admin makes them an
                      Admin; --domain <id> (repeatable) makes them an owner of that domain. This
                      is how the first admin of an install that signs in with OIDC gets in.

Commands that use the service:
  draft <file>        Save one item as a draft proposal. --submit sends it for review.
  import <file>       Check every item against the live edition; changes nothing.
                      --apply makes the proposals (all or none) and submits them;
                      --drafts with --apply keeps them as drafts.
  import-tests <file> Check a file of test questions (YAML or JSON); changes nothing.
                      --apply saves them (all or none): new ones are created, changed
                      ones replaced (owners and deputies of their domains, administrators).
  export [label]      Write the live edition, or the one named, as canonical JSON
                      (owners, deputies and administrators).
  audit               Export the history log (administrators and auditors).
                      --format jsonl|csv, --from YYYY-MM-DD, --to YYYY-MM-DD, --action name,
                      --request <id> (the request id its log lines carry)

Options:
  --url <url>         The service (HEED_URL, else http://127.0.0.1:3000)
  --as <email>        Sign in as this person from the dev people file (HEED_EMAIL)
  --origin <origin>   The origin to present for changes (HEED_ORIGIN, else the first
                      of CL_WEB_ORIGINS, else the service's default, ${DEFAULT_WEB_ORIGINS[0]})
  --out <file>        Write the result to a file instead of standard output
  --json              Print the result as JSON, for scripts and agents
  --help              Show this help

An item file is a list of items, or an object with an "items" list; an edition export is one.
An item with an "id" proposes a change to that accepted item; without one, a new item.
Mentions are @[words](target) tokens in summaryMarkup and bodyMarkup.
A test question file is a list of questions, or an object with a "questions" list.
Templates with worked examples: docs/templates/.
Exit status: 0 done, 1 problems found or the service refused, 2 wrong usage.`

class UsageError extends Error {}

export const options = {
  url: { type: 'string' },
  as: { type: 'string' },
  origin: { type: 'string' },
  out: { type: 'string' },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
  apply: { type: 'boolean', default: false },
  drafts: { type: 'boolean', default: false },
  submit: { type: 'boolean', default: false },
  format: { type: 'string', default: 'jsonl' },
  from: { type: 'string' },
  to: { type: 'string' },
  action: { type: 'string' },
  request: { type: 'string' },
  admin: { type: 'boolean', default: false },
  domain: { type: 'string', multiple: true },
} as const

type Values = ReturnType<
  typeof parseArgs<{ options: typeof options; allowPositionals: true }>
>['values']

function describe(findings: readonly FormatFinding[]): string[] {
  return findings.map(
    (f) =>
      `    ${f.severity === 'error' ? 'error' : 'warning'} ${f.code}${f.field ? ` (${f.field})` : ''}: ${f.message}`,
  )
}
const hasErrors = (findings: readonly FormatFinding[]) =>
  findings.some((f) => f.severity === 'error')

async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    throw new UsageError(`Cannot read ${file}: ${(error as NodeJS.ErrnoException).code ?? 'error'}`)
  }
}

async function readDocument(file: string): Promise<unknown> {
  const text = await readText(file)
  try {
    return parse(text, { maxAliasCount: 0 }) as unknown
  } catch {
    throw new UsageError(`${file} is neither YAML nor JSON`)
  }
}

export async function run(argv: readonly string[], io: Io): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({ args: [...argv], options, allowPositionals: true, strict: true })
  } catch (error) {
    io.stderr(`${(error as Error).message}\n\n${usage}\n`)
    return 2
  }
  const { values, positionals } = parsed
  const [command, ...rest] = positionals
  if (values.help) {
    io.stdout(usage + '\n')
    return 0
  }
  if (!command) {
    io.stderr(usage + '\n')
    return 2
  }
  const write = async (text: string) => {
    if (values.out) await writeFile(values.out, text)
    else io.stdout(text)
  }
  const print = (lines: string[], json: unknown) =>
    io.stdout(values.json ? JSON.stringify(json, null, 2) + '\n' : lines.join('\n') + '\n')
  const one = (what: string) => {
    if (rest.length !== 1) throw new UsageError(`${command} takes one ${what}`)
    return rest[0]!
  }
  try {
    switch (command) {
      case 'validate': {
        const file = readItemFile(await readDocument(one('file')))
        if (file.error) throw new UsageError(file.error)
        const entries = file.entries.map((entry) => ({
          index: entry.index,
          itemId: entry.itemId,
          title: entry.draft?.title ?? null,
          findings: offlineFindings(entry),
        }))
        const failed = entries.filter((e) => hasErrors(e.findings)).length
        print(
          [
            ...entries.flatMap((e) => [
              `${e.index}: ${e.itemId ?? 'new item'}${e.title ? ` "${e.title}"` : ''}`,
              ...describe(e.findings),
            ]),
            `${entries.length} items, ${failed} with errors`,
          ],
          { entries, failed },
        )
        return failed ? 1 : 0
      }
      case 'schema':
        if (rest.length) throw new UsageError('schema takes no arguments')
        await write(JSON.stringify(itemJsonSchema(), null, 2) + '\n')
        return 0
      case 'verify': {
        const document = (await readDocument(one('file'))) as EditionExport
        if (!document || typeof document !== 'object' || !Array.isArray(document.items))
          throw new UsageError('Expected an edition export')
        const check = await verifyEditionExport(document)
        const ok = check.edition && !check.items.length && !check.vocabulary.length
        print(
          [
            `edition ${document.edition?.label ?? '?'}: ${check.edition ? 'digest matches' : 'DIGEST DIFFERS'}`,
            ...check.items.map((id) => `  item ${id}: content does not give its digest`),
            ...check.vocabulary.map((key) => `  term ${key}: content does not give its digest`),
          ],
          check,
        )
        return ok ? 0 : 1
      }
    }
    if (command === 'invite') return await invite(one('email address'), values, io, print)
    if (!['draft', 'import', 'import-tests', 'export', 'audit'].includes(command))
      throw new UsageError(`Unknown command: ${command}`)
    const client = await connect(values, io)
    switch (command) {
      case 'draft':
        return await draft(client, one('file'), values, print)
      case 'import':
        return await importFile(client, one('file'), values, print)
      case 'import-tests':
        if (values.drafts) throw new UsageError('--drafts is for items; test questions have none')
        return await importTests(client, one('file'), values, print)
      case 'export': {
        if (rest.length > 1) throw new UsageError('export takes at most one edition label')
        const label = rest[0] ?? (await liveLabel(client))
        const document = await client.editions.export({ label })
        await write(canonicalJson(document) + '\n')
        if (values.out)
          io.stderr(
            `Wrote edition ${label}: ${document.items.length} items, digest ${document.digest}\n`,
          )
        return 0
      }
      case 'audit':
        return await audit(client, values, write, rest, io)
    }
    return 2
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`${error.message}\n\nRun heed --help for the commands.\n`)
      return 2
    }
    if (error instanceof ORPCError) {
      const findings = (error.data as { findings?: FormatFinding[] } | undefined)?.findings
      const hint =
        error.code === 'UNAUTHORIZED'
          ? "Sign in as a person in the service's dev people file (--as, HEED_EMAIL)."
          : error.code === 'FORBIDDEN' && command === 'audit'
            ? 'The history log is for administrators and auditors.'
            : error.code === 'FORBIDDEN' && command === 'export'
              ? 'Editions are for owners, deputies and administrators.'
              : error.code === 'FORBIDDEN' && command === 'import-tests'
                ? 'Test questions are kept by owners, deputies and administrators.'
                : null
      io.stderr(
        [
          `The service refused: ${error.message} (${String(error.code)})`,
          ...(hint ? [hint] : []),
          ...describe(findings ?? []),
        ].join('\n') + '\n',
      )
      return 1
    }
    if (error instanceof TypeError && /fetch failed/.test(error.message)) {
      io.stderr(`Cannot reach the service at ${serviceUrl(values, io)}. Is it running?\n`)
      return 1
    }
    throw error
  }
}

const serviceUrl = (values: Values, io: Io) =>
  values.url ?? io.env.HEED_URL ?? 'http://127.0.0.1:3000'

async function connect(values: Values, io: Io): Promise<HeedClient> {
  const url = serviceUrl(values, io)
  if (!URL.canParse(url)) throw new UsageError(`Not a URL: ${url}`)
  const email = values.as ?? io.env.HEED_EMAIL
  if (!email) throw new UsageError('Say who you are: --as <email> or HEED_EMAIL')
  // The service checks the origin of every change, as for a browser (CL_WEB_ORIGINS).
  const origin =
    values.origin ??
    io.env.HEED_ORIGIN ??
    io.env.CL_WEB_ORIGINS?.split(',')[0]?.trim() ??
    DEFAULT_WEB_ORIGINS[0]
  const connection = createClient({ url, origin, ...(io.fetch ? { fetch: io.fetch } : {}) })
  await connection.signIn(email)
  return connection.client
}

async function liveLabel(client: HeedClient): Promise<string> {
  for (let offset = 0; ; offset += 100) {
    const page = await client.editions.list({ limit: 100, offset })
    const live = page.find((edition) => edition.live)
    if (live) return live.label
    if (page.length < 100) throw new UsageError('There is no live edition yet')
  }
}

async function draft(
  client: HeedClient,
  path: string,
  values: Values,
  print: (lines: string[], json: unknown) => void,
): Promise<number> {
  const file = readItemFile(await readDocument(path))
  if (file.error) throw new UsageError(file.error)
  if (file.entries.length !== 1)
    throw new UsageError('draft takes a file with one item; import takes several')
  const entry = file.entries[0]!
  if (!entry.draft || hasErrors(entry.findings)) {
    print(['The item is not valid:', ...describe(entry.findings)], { findings: entry.findings })
    return 1
  }
  let proposal = await client.proposals.create({
    draft: entry.draft,
    ...(entry.itemId ? { itemId: entry.itemId } : {}),
    channel: 'command_line',
  })
  if (values.submit)
    proposal = await client.proposals.submit({ id: proposal.id, revision: proposal.revision })
  print(
    [
      `Proposal ${proposal.number} (${proposal.id}) is ${proposal.state}, domain ${proposal.areaId}`,
      ...describe(proposal.findings),
    ],
    proposal,
  )
  return 0
}

async function importFile(
  client: HeedClient,
  path: string,
  values: Values,
  print: (lines: string[], json: unknown) => void,
): Promise<number> {
  if (values.drafts && !values.apply) throw new UsageError('--drafts goes with --apply')
  const report: ItemImportReport = await client.imports.items({
    content: await readText(path),
    dryRun: !values.apply,
    submit: !values.drafts,
    sourceName: basename(path).slice(0, 200),
  })
  const { counts } = report
  const outcome = report.error
    ? report.error
    : report.applied
      ? `Imported as batch ${report.batchId}: ${counts.create} new, ${counts.change} changed, ${counts.unchanged} unchanged${values.drafts ? ' (drafts)' : ', submitted for review'}`
      : counts.errors
        ? `Nothing imported: ${counts.errors} of ${report.entries.length} items have errors`
        : `Dry run: ${counts.create} new, ${counts.change} changed, ${counts.unchanged} unchanged. Run again with --apply to make the proposals.`
  print(
    [
      ...report.entries.flatMap((e) => [
        [
          `${e.index}: ${e.action}`,
          e.itemId,
          e.title && `"${e.title}"`,
          e.proposalId && `-> proposal ${e.proposalId}`,
        ]
          .filter(Boolean)
          .join(' '),
        ...describe(e.findings),
      ]),
      outcome,
    ],
    report,
  )
  return report.error || counts.errors ? 1 : 0
}

async function importTests(
  client: HeedClient,
  path: string,
  values: Values,
  print: (lines: string[], json: unknown) => void,
): Promise<number> {
  const report = await client.evals.questions.import({
    content: await readText(path),
    dryRun: !values.apply,
  })
  const counts = `${report.created.length} new, ${report.updated.length} changed, ${report.unchanged.length} unchanged`
  const outcome = report.errors.length
    ? `Nothing saved: ${report.errors.length} with errors`
    : report.applied
      ? `Saved: ${counts}`
      : `Dry run: ${counts}. Run again with --apply to save them.`
  print(
    [
      ...report.errors.map(
        (e) => `${e.index < 0 ? 'file' : `${e.index}: ${e.id ?? 'question'}`}: ${e.message}`,
      ),
      ...report.created.map((id) => `new ${id}`),
      ...report.updated.map((id) => `changed ${id}`),
      outcome,
    ],
    report,
  )
  return report.errors.length ? 1 : 0
}

async function audit(
  client: HeedClient,
  values: Values,
  write: (text: string) => Promise<void>,
  rest: string[],
  io: Io,
): Promise<number> {
  if (rest.length) throw new UsageError('audit takes options only')
  const format = values.format === 'csv' ? 'csv' : values.format === 'jsonl' ? 'jsonl' : null
  if (!format) throw new UsageError('--format is jsonl or csv')
  const filters = {
    ...(values.from ? { from: values.from } : {}),
    ...(values.to ? { to: values.to } : {}),
    ...(values.action ? { action: values.action } : {}),
    ...(values.request ? { requestId: values.request } : {}),
  }
  let content = ''
  let after: number | undefined
  let chain
  for (;;) {
    const page = await client.audit.export({
      ...filters,
      format,
      ...(after === undefined ? {} : { after }),
    })
    // A CSV page repeats the header row; keep the first.
    content +=
      after !== undefined && page.format === 'csv'
        ? page.content.slice(page.content.indexOf('\n') + 1)
        : page.content
    chain = page.chain
    if (page.next === null) break
    after = page.next
  }
  await write(content)
  if (!chain.verified) {
    io.stderr(`The history log's hash chain breaks at entry ${chain.firstBadSeq}\n`)
    return 1
  }
  return 0
}

async function invite(
  email: string,
  values: Values,
  io: Io,
  print: (lines: string[], json: unknown) => void,
): Promise<number> {
  if (!/^[^@\s]+@[^@\s]+$/.test(email.trim()))
    throw new UsageError(`${email} is not an email address`)
  const databaseUrl = io.env.DATABASE_URL_MIGRATE
  if (!databaseUrl)
    throw new UsageError(
      "Set DATABASE_URL_MIGRATE to the database owner's address (db/README.md): an invite from here is made in the database.",
    )
  const webOrigin =
    values.origin ?? io.env.CL_WEB_ORIGINS?.split(',')[0]?.trim() ?? DEFAULT_WEB_ORIGINS[0]
  const result = await operatorInvite({
    databaseUrl,
    webOrigin,
    email,
    admin: values.admin,
    domains: values.domain ?? [],
  })
  if (result.outcome === 'member') {
    print([`${email} is in the workspace already.`], result)
    return 1
  }
  if (result.outcome === 'unknown_domain') {
    print([`There is no domain ${result.domain}.`], result)
    return 1
  }
  print(
    [
      `Invited ${email}${values.admin ? ' as an Admin' : ''}. Send them this link; it works until ${result.expiresAt}:`,
      result.link,
    ],
    result,
  )
  return 0
}
