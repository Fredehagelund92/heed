import type { ConnectInfo } from '@/api/client'
import { orderTools, toolInfo, toolName } from '@/lib/gateway'
import { productName } from '@/lib/brand'
import {
  absenceRule,
  answerLineRule,
  askFirstLine,
  contextRule,
  dataRule,
  datesRule,
  formatRule,
  namesRule,
  plainWordsRule,
  reportRule,
  statusRuleWords,
  statusRules,
  suggestRule,
} from '@domain/mcp-text'

/*
  Connect your AI: how a person points their own AI client at Heed. The service lists the
  address, every tool with whether it is on, and the clients that may connect; this file turns
  them into plain words and a snippet to paste for each client. A client that can sign in
  (FR-403) needs only the address; one that cannot sends a token the data platform team gives out.
*/

/** What a person pastes in place of the token: the access key the data team gives them. */
export const TOKEN_PLACEHOLDER = '<your access key>'

/** The name Heed has in a client's list of servers. */
const SERVER_NAME = 'heed'

/** Where a snippet goes and how to read it: a command to run, or a settings file to edit. */
export type Snippet = {
  /** The client's own words for where the snippet goes. */
  where: string
  /** `shell` for a command, `json` for a settings file. */
  language: 'shell' | 'json'
  code: string
}

const json = (value: unknown) => JSON.stringify(value, null, 2)
const bearer = `Bearer ${TOKEN_PLACEHOLDER}`

/** How a client proves who it is: it signs in to Heed in the browser, or sends a token. */
export type ConnectAuth = 'sign-in' | 'token'

/**
 * The snippet for one client, by its label. Claude Code, Cursor and VS Code have their own; any
 * other client gets the common `mcpServers` settings shape that most clients read. A client that
 * signs in gets the address alone; with a token, it also sends the Authorization header.
 */
export function snippetFor(label: string, address: string, auth: ConnectAuth = 'token'): Snippet {
  const token = auth === 'token'
  const headers = token ? { headers: { Authorization: bearer } } : {}
  switch (label) {
    case 'claude-code':
      return {
        where: 'Run this in a terminal.',
        language: 'shell',
        code:
          `claude mcp add --transport http ${SERVER_NAME} ${address}` +
          (token ? ` \\\n  --header "Authorization: ${bearer}"` : ''),
      }
    case 'vscode':
      return {
        where: 'Add this to .vscode/mcp.json in your project.',
        language: 'json',
        code: json({ servers: { [SERVER_NAME]: { type: 'http', url: address, ...headers } } }),
      }
    case 'cursor':
      return {
        where:
          'Add this to .cursor/mcp.json in your project, or to ~/.cursor/mcp.json for every project.',
        language: 'json',
        code: json({ mcpServers: { [SERVER_NAME]: { url: address, ...headers } } }),
      }
    default:
      return {
        where: "Add this to the agent's MCP server settings.",
        language: 'json',
        code: json({ mcpServers: { [SERVER_NAME]: { url: address, ...headers } } }),
      }
  }
}

/** The apps with a setup of their own (snippetFor), by the name a person knows them by. */
const appNames: Record<string, string> = {
  'claude-code': 'Claude Code',
  vscode: 'VS Code',
  cursor: 'Cursor',
}

/**
 * The name a person sees over a client's setup: the app's own for an app with a setup of its own,
 * since an administrator's row names how the app connects ("Claude Code with a token") rather than
 * the app a person looks for; any other client goes by its row's name.
 */
export function appNameFor(client: { label: string; name: string }): string {
  return appNames[client.label] ?? client.name
}

/** The other names an app reports for itself when it signs in, besides the one a person knows. */
const reportedNames: Record<string, string[]> = {
  vscode: ['Visual Studio Code'],
}

const normalName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Whether a sign-in's reported name is the app: equal once case, spaces and punctuation are set aside. */
export function isReportedAs(client: { label: string; name: string }, reported: string): boolean {
  const names = [appNameFor(client), ...(reportedNames[client.label] ?? [])]
  return names.some((name) => normalName(name) === normalName(reported))
}

/**
 * The lines a person adds to their agent's standing instructions so it asks Heed before it answers
 * (Ask first). An app still decides by itself when to call a tool: a line makes the call more
 * likely and never sure, so nothing that shows these lines may promise it. The help guide
 * (docs/help/connect-an-agent.md) shows the same lines, word for word.
 */
export const askHeedFirst = [
  {
    where:
      'Add it to CLAUDE.md or AGENTS.md in your project. Claude Code and other coding tools read that file when they start.',
    label: 'the line for CLAUDE.md or AGENTS.md',
    // The line the MCP server and the Connect page share (src/domain/mcp-text.ts).
    text: askFirstLine,
  },
  {
    where: `Add it to a data tool's own instructions for its AI, when that AI is connected to ${productName}.`,
    label: "the line for a data tool's instructions",
    text: `When someone asks why a number moved, or before you trust a number, ask ${productName} with get_context for the events, caveats and definitions that apply.`,
  },
] as const

/** The settings file a snippet goes in, as its words name it: `.cursor/mcp.json`. */
const settingsFile = (snippet: Snippet) => snippet.where.match(/\S+mcp\.json/)?.[0] ?? null

/** The file a coding agent reads its standing instructions from: Claude Code's own, or the shared one. */
const instructionsFile = (label: string) => (label === 'claude-code' ? 'CLAUDE.md' : 'AGENTS.md')

/** How the person signs in from an app, once its setup is in: Claude Code's own steps, or the app's. */
const signInStep = (label: string, name: string) =>
  label === 'claude-code'
    ? `start Claude Code again, run /mcp, choose ${SERVER_NAME} and then Authenticate, and sign in to ${productName} in the browser that opens`
    : `open ${name}'s MCP settings, and sign in to ${productName} in the browser when ${name} asks`

/** A part of the setup prompt: words to read, or a line to paste or run word for word. */
export type PromptPart = { kind: 'words' | 'code'; text: string }

/**
 * The setup prompt (Connect your AI's card, D9): one text a person pastes into their agent, which
 * adds Heed, writes the Ask first line into its instructions file and then says how to sign in, as
 * Notion's setup prompt does. A client that signs in gets the address alone and the app does the
 * setup; with a token, the person runs or edits the setup themselves, so the token never goes
 * into the conversation. In parts, so the card can set the code apart; `promptText` joins them.
 */
export function setupPromptFor(
  client: { label: string; name: string },
  address: string,
  auth: ConnectAuth,
): PromptPart[] {
  const name = appNameFor(client)
  const snippet = snippetFor(client.label, address, auth)
  const settings = settingsFile(snippet) ?? "the agent's MCP server settings"
  const token = auth === 'token'
  const add =
    snippet.language === 'shell'
      ? token
        ? `Tell me to run this in a terminal, with the access key the data team gave me in place of ${TOKEN_PLACEHOLDER}:`
        : 'Run this in a terminal:'
      : token
        ? `Add this to ${settings}, and tell me to put the access key the data team gave me in place of ${TOKEN_PLACEHOLDER}:`
        : `Add this to ${settings}:`
  const words = (text: string): PromptPart => ({ kind: 'words', text })
  const code = (text: string): PromptPart => ({ kind: 'code', text })
  return [
    words(
      `Connect this project to ${productName}, which holds reviewed facts about our company's metrics.`,
    ),
    words(`1. ${add}`),
    code(snippet.code),
    words(
      `2. Add this line to ${instructionsFile(client.label)} in this project, and create the file if there is none:`,
    ),
    code(askHeedFirst[0].text),
    words(`3. Then tell me to ${token ? `start ${name} again` : signInStep(client.label, name)}.`),
  ]
}

/** The setup prompt as it is copied: its parts, a blank line apart. */
export const promptText = (parts: readonly PromptPart[]) =>
  parts.map((part) => part.text).join('\n\n')

/** Where a downloaded skill goes, by the agents that read it (each reads a folder named after the skill). */
export const skillPlaces = [
  { agents: 'Claude Code', path: `.claude/skills/${SERVER_NAME}/SKILL.md` },
  { agents: 'Codex and Cursor', path: `.agents/skills/${SERVER_NAME}/SKILL.md` },
] as const

/**
 * How a coding agent reads get_context's status, word for word as the MCP server's instructions
 * say it (src/domain/mcp-text.ts, FR-343), so the skill and the server never disagree.
 */
export { statusRules, statusRuleWords }

/**
 * The Heed skill (SKILL.md, an Agent Skills file): what Claude Code, Codex or Cursor needs to ask
 * Heed first and to read what it answers, with this install's address in each app's setup line.
 * It repeats the server's rules rather than adding any: a skill makes a call more likely, and the
 * server's instructions still govern what an answer may say.
 */
/* eslint-disable heed/plain-words -- the skill is written for coding agents, in the MCP server's words */
export function skillFor(address: string, auth: ConnectAuth): string {
  const cursor = snippetFor('cursor', address, auth)
  const token = auth === 'token'
  return [
    '---',
    `name: ${SERVER_NAME}`,
    `description: Ask ${productName} before you answer a question about company data, such as a metric, a market or a number that moved. ${productName} holds the reviewed caveats, events, definitions and data breaks around company metrics, not the data.`,
    '---',
    '',
    `# ${productName}`,
    '',
    `${productName} holds checked context about our company's metrics: the caveats, events, definitions and known data breaks that the owner of each domain checked before ${productName} served them. It holds no data and runs no queries: the data tool holds the number, and ${productName} holds what to know before you trust or explain it.`,
    '',
    '## Ask first',
    '',
    askHeedFirst[0].text,
    '',
    // The MCP server's own rules, word for word (src/domain/mcp-text.ts).
    `- ${namesRule}`,
    '- Each reply has status, its answer state, then say, a sentence for the person, and next, your step.',
    `- ${answerLineRule}`,
    `- ${contextRule}`,
    `- ${plainWordsRule}`,
    `- ${datesRule}`,
    `- ${formatRule}`,
    '',
    '## Read the status before you answer',
    '',
    ...statusRules.map((rule) => `- ${statusRuleWords(rule)}`),
    '',
    absenceRule,
    '',
    '## Report and suggest',
    '',
    `- ${reportRule}`,
    `- ${suggestRule}`,
    '',
    '## Keep it safe',
    '',
    `- ${dataRule}`,
    '',
    `## Connect ${productName}`,
    '',
    `${productName}'s address is ${address}.`,
    token
      ? `Each agent sends a token the data platform team gives out, in place of ${TOKEN_PLACEHOLDER}.`
      : `Each agent signs in to ${productName} in the browser the first time, and then reads only what that person can read.`,
    '',
    'Claude Code:',
    '',
    '```sh',
    snippetFor('claude-code', address, auth).code,
    '```',
    '',
    ...(token ? [] : [`Then run /mcp, choose ${SERVER_NAME} and then Authenticate.`, '']),
    ...(token
      ? [
          'Codex, in ~/.codex/config.toml, with the token in the HEED_TOKEN environment variable:',
          '',
          '```toml',
          `[mcp_servers.${SERVER_NAME}]`,
          `url = "${address}"`,
          'bearer_token_env_var = "HEED_TOKEN"',
          '```',
        ]
      : [
          'Codex:',
          '',
          '```sh',
          `codex mcp add ${SERVER_NAME} --url ${address}`,
          `codex mcp login ${SERVER_NAME}`,
          '```',
        ]),
    '',
    `Cursor, in ${settingsFile(cursor)}:`,
    '',
    '```json',
    cursor.code,
    '```',
    '',
    'Save this file as:',
    '',
    ...skillPlaces.map((place) => `- ${place.path} for ${place.agents}`),
    '',
  ].join('\n')
}
/* eslint-enable heed/plain-words */

/** The skill's file name, as it downloads. */
export const SKILL_FILE = 'SKILL.md'

/**
 * Every tool, in the gateway screen's order, each with its name, what it does, whether it is on
 * and whether it needs a signed-in person.
 */
export function toolsInWords(tools: ConnectInfo['tools']) {
  return orderTools(tools).map((tool) => ({
    ...tool,
    name: toolName(tool.tool),
    about: toolInfo[tool.tool]?.about ?? null,
  }))
}
