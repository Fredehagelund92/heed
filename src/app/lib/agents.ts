import claude from '@/assets/logos/claude.svg'
import cursor from '@/assets/logos/cursor.svg'
import openai from '@/assets/logos/openai.svg'
import vscode from '@/assets/logos/vscode.svg'
import { MCP_URL, SLUG } from '@/lib/brand'
import type { LivePhase } from '@/lib/connect'

// How an agent connects. One prompt first: the agent adds the server, writes the Ask-first line into
// the project's instructions file and says how to sign in. Quick links where a client has a real
// one (Cursor, VS Code), one line to copy for the rest, and every agent's steps by hand in a fold.
// The product's name appears only inside commands and the address. Logos are Simple Icons (CC0).

export const ADDRESS = MCP_URL

/** What a coding agent adds to its instructions so it asks before it answers about numbers. */
export const ASK_FIRST_LINE =
  'Before you answer a question about company data, call get_context first and use what it returns.'

export const CLAUDE_CODE_COMMAND = `claude mcp add --transport http ${SLUG} ${ADDRESS}`

/** The prompt, as parts: the page shows each part and copies them joined, so the copy is the screen. */
export const PROMPT_PARTS: { code?: true; text: string }[] = [
  {
    text: "Connect this agent to our team's checked context, so it checks it before it answers about company numbers.",
  },
  {
    text: `1. Add a remote MCP server at ${ADDRESS}, over HTTP, in your own way of doing that. In Claude Code, run:`,
  },
  { code: true, text: CLAUDE_CODE_COMMAND },
  {
    text: '2. Add this line to the instructions file this project uses: CLAUDE.md if it exists, otherwise AGENTS.md, which you can create:',
  },
  { code: true, text: ASK_FIRST_LINE },
  {
    text: '3. Then tell me how to sign in. A browser window opens once, and I approve the connection there. Never ask me for a key or a token. Change nothing else.',
  },
]

export const PROMPT = PROMPT_PARTS.map((p) => p.text).join('\n\n')

/** Cursor's install link: the server's name and a base64 config with its address. */
export const cursorLink = (name = SLUG, url = ADDRESS) =>
  `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(btoa(JSON.stringify({ url })))}`

/** VS Code's install link: the server as URL-encoded JSON. */
export const vscodeLink = (name = SLUG, url = ADDRESS) =>
  `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name, url }))}`

export type AgentId =
  'claude-code' | 'claude-app' | 'cursor' | 'vscode' | 'codex' | 'chatgpt' | 'other'

export type Step = { what: string; copy?: string }

export type AgentGuide = {
  id: AgentId
  /** The name a connected row and the live line use. */
  name: string
  logo: string
  /** Each agent's steps by hand, the last one always the sign-in. */
  steps: Step[]
}

const instructions = (file: string): Step => ({
  what: `Add this line to ${file}, so it checks first:`,
  copy: ASK_FIRST_LINE,
})

export const GUIDES: AgentGuide[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    logo: claude,
    steps: [
      { what: 'Run this in a terminal:', copy: CLAUDE_CODE_COMMAND },
      instructions('CLAUDE.md if the project has one, otherwise AGENTS.md'),
      {
        what: 'In Claude Code, type /mcp, choose the server you added, press Authenticate, and approve the connection in the browser.',
      },
    ],
  },
  {
    id: 'claude-app',
    name: 'Claude',
    logo: claude,
    steps: [
      { what: 'Copy the address:', copy: ADDRESS },
      {
        what: 'In Claude, open Customize, then Connectors. Press + Add, then Add custom connector, and paste the address.',
      },
      { what: 'Press Add, then Connect, and approve the connection in the browser.' },
      {
        what: 'On a Team or Enterprise plan an owner adds it under Organization settings, Connectors; then each person presses Connect.',
      },
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    logo: cursor,
    steps: [
      {
        what: 'Add this to .cursor/mcp.json:',
        copy: `{ "mcpServers": { "${SLUG}": { "url": "${ADDRESS}" } } }`,
      },
      instructions('AGENTS.md'),
      {
        what: "In Cursor's settings, under MCP, press Connect and approve the connection in the browser.",
      },
    ],
  },
  {
    id: 'vscode',
    name: 'VS Code',
    logo: vscode,
    steps: [
      {
        what: 'Add this to .vscode/mcp.json:',
        copy: `{ "servers": { "${SLUG}": { "type": "http", "url": "${ADDRESS}" } } }`,
      },
      instructions('AGENTS.md'),
      { what: 'Start the server from the file, and approve the connection in the browser.' },
    ],
  },
  {
    id: 'codex',
    name: 'Codex',
    logo: openai,
    steps: [
      { what: 'Run this in a terminal:', copy: `codex mcp add ${SLUG} --url ${ADDRESS}` },
      instructions('AGENTS.md'),
      {
        what: 'Run this, and approve the connection in the browser:',
        copy: `codex mcp login ${SLUG}`,
      },
    ],
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    logo: openai,
    steps: [
      { what: 'Copy the address:', copy: ADDRESS },
      {
        what: 'In ChatGPT on the web, open Settings, Apps and Connectors, Advanced settings, and turn on Developer mode.',
      },
      {
        what: 'Press Create, name it, paste the address, choose OAuth, and approve the connection in the browser.',
      },
      { what: 'On a Business or Enterprise plan an admin turns on connectors first.' },
    ],
  },
  {
    id: 'other',
    name: 'Your agent',
    logo: openai,
    steps: [
      { what: 'Copy the address:', copy: ADDRESS },
      { what: 'Add it where your agent lists its connectors or MCP servers, over HTTP.' },
      {
        what: 'Approve the connection in the browser when it asks. If the agent reads an instructions file, add this line to it:',
        copy: ASK_FIRST_LINE,
      },
    ],
  },
]

export const guide = (id: AgentId) => GUIDES.find((g) => g.id === id)!

/** A connected agent's logo, by the name it reported when it signed in. */
export function logoFor(agent: string) {
  if (/^Claude/.test(agent)) return claude
  if (agent === 'Cursor') return cursor
  if (agent === 'VS Code') return vscode
  return openai
}

/** The tools an agent can call, with what each does in plain words: Settings and the docs list the same. */
export const AGENT_TOOLS: { name: string; what: string; takes: string; returns: string }[] = [
  {
    name: 'get_context',
    what: 'The context that applies to a question, with one sentence to relay.',
    takes: 'The question, or a metric, markets and dates.',
    returns: 'The answer line, the context items that apply, and one sentence to relay.',
  },
  {
    name: 'find_context',
    what: 'A word search over names, titles and summaries.',
    takes: 'A few words.',
    returns: 'Matching context items and definitions, titles only.',
  },
  {
    name: 'read_context',
    what: 'One context item in full.',
    takes: 'A context item.',
    returns: "Its text, source, check date and don't conclude line.",
  },
  {
    name: 'report',
    what: 'Tell the owner something is missing, wrong or unclear.',
    takes: 'What is wrong, after the person says yes.',
    returns: 'That it was sent, and to which owner.',
  },
  {
    name: 'suggest_context',
    what: 'Send a suggestion to the owner, after the person says yes.',
    takes: 'The suggested text and what it applies to.',
    returns: "That it waits in the owner's Inbox.",
  },
  {
    name: 'get_related',
    what: 'Follow a link between context items, definitions and domains, one step at a time.',
    takes: 'A context item, a definition or a domain.',
    returns: 'What it links to and is linked from, without changing what an answer includes.',
  },
]

/** The tools a connected agent can call on connecting, as the live line names them. */
export const TOOL_NAMES = AGENT_TOOLS.filter((t) => t.name !== 'get_related').map((t) => t.name)

/* ---------- What the live line says ---------- */

/** How a wait began: it decides which agent the demo signs in, and what the live line says to do. */
export type Via = 'prompt' | AgentId

export const WAIT_HINT: Record<Via, string> = {
  prompt:
    'Paste the prompt into your agent, then approve the connection in the browser when it asks.',
  'claude-code':
    'Run the command in a terminal, then type /mcp in Claude Code, choose the server and press Authenticate.',
  'claude-app': 'In Claude, add a custom connector with the address, then press Connect.',
  cursor: 'Install it in Cursor, then approve the connection in the browser.',
  vscode: 'Install it in VS Code, then approve the connection in the browser.',
  codex: 'Run the two commands in a terminal, then approve the connection in the browser.',
  chatgpt: 'Add the address in ChatGPT as a connector, then approve the connection in the browser.',
  other: 'Add the address to your agent, then approve the connection in the browser.',
}

/** What usually goes wrong, shown after 2 minutes and when checking stops. */
export const CHECKS = [
  'Paste the prompt into your agent and press Enter.',
  'Say yes when the agent asks to run the command.',
  'Approve the connection in the browser, or ask your agent how to sign in.',
  'If it says the server already exists, ask it to remove the old one and try again.',
]

/** The live line's two lines, per state. Connected names the agent as it reported itself, and the person. */
export function liveCopy(
  phase: LivePhase,
  via: Via,
  agent: string,
  me: string,
): { title: string; body?: string } {
  switch (phase) {
    case 'idle':
      return {
        title: 'Not connected yet',
        body: 'After you paste it, this page says Connected. It checks every few seconds.',
      }
    case 'waiting':
      return { title: 'Waiting for your agent to connect…', body: WAIT_HINT[via] }
    case 'hint':
      return {
        title: 'Still waiting. Nothing has signed in yet.',
        body: 'It keeps checking for a few more minutes. What usually helps:',
      }
    case 'connected':
      return { title: `Connected: ${agent}, ${me}` }
    case 'timeout':
      return {
        title: 'Stopped checking after 10 minutes. Nothing has signed in.',
        body: 'What usually helps, before you check again:',
      }
    case 'declined':
      return {
        title: 'The connection was declined in the browser. Nothing is connected.',
        body: 'Paste the prompt again, and choose Allow when the browser asks.',
      }
  }
}
