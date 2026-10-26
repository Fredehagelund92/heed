import { productName } from '../../brand.ts'

/*
  The reads the in-app assistant calls in process, by the ids and with the words they had as MCP
  tools before the agent contract (docs/product.md, section 10). The agent contract renamed some
  of them and took the others out of what agents get; the assistant keeps them as they were until
  Ask is rebuilt on the answer engine. Each runs the tool service's own code
  (src/server/mcp/service.ts), and each only reads.
*/

const prefix = 'Call get_facts before answering a question about company data. '
const describe = (line: string, text: string, first = prefix) => `${line} ${first}${text}`

/** Each read the assistant offers, with the description it gives its model. */
export const assistantReads = {
  get_facts: describe(
    'Finds the checked facts that apply to a question, with their sources.',
    `Pass structured metrics, dimension_filters and inclusive UTC dates when known. Without window, the dates in the question are read (such as 2026, last quarter or 1 Jan to 30 Sep) and dates_read says how; without any dates, the question is read at today and assumed_date says so. The member names you just queried in the data tool work as names, and a name that isn't known comes back with the closest that is. A dimension filter with no values names the dimension for every value, as in a breakdown by market. Returns the checked facts (items) that apply, with their sources, coverage and links, and the domain of each asked metric; with response_format concise, a short reply without bodies, evidence and links. A link neither widens where a fact applies nor proves a cause. Read a linked fact with read_item only when it helps answer the question.`,
  ),
  find_facts: describe(
    'Finds facts by the words people use, such as GMV or Spain, and what each metric means.',
    `Find what is written down about a few words or a question, by the names people use: metrics and their other names (such as GMV), markets, domains, member names from the data tool (such as payments.orders), and words in a fact. Use it for "what do we know about", "what is" or "how is it defined", and when you don't know the exact names. Returns the matching facts (items) with titles and summaries, and for each metric or dimension the words name: the definition its source gives, where that definition comes from, and what these facts add. When no words match, it returns the facts that apply to what the words name, on the dates the window or the words give (dates_read says how it read the words) or else today, as assumed_date says; when nothing is found, why says what to try. Read a fact in full with read_item.`,
  ),
  read_item: describe(
    'Reads one fact in full, with its source.',
    'Read one fact (item) you may see, with its sources and outgoing links, plus a page of the facts that link to it. An edition needs a service token with edition scope. A link proves neither that a fact applies nor a cause.',
  ),
  improve_question: describe(
    'Checks the dates, metrics and markets in a question. No AI is used.',
    'Check the dates, definitions and markets of a question, the same way every time. Suggests comparisons, overlapping events and guides that apply.',
  ),
  domain_overview: describe(
    'Says what a domain covers, who owns it and what needs checking.',
    'Describe a domain in one call: what it is and what kind of data it holds, as its owners wrote it, its owners, what it covers, the facts that need checking, its open gaps and its recent changes. Without a domain, lists every domain with its summary line and those counts, and the metric and dimension names known here. Name the domain as people do, such as Sales.',
  ),
  what_changed: describe(
    'Lists the facts that were added, changed or archived.',
    'Say what changed for agents between two editions: by default the live edition and the one before. Filter by domain. Use it for "what changed", "what is new" or "what was archived" (retired). Facts agents don\'t get are counted, not named.',
  ),
  search_help: describe(
    'Answers how-to questions from the help pages.',
    `Answer a question about how ${productName} itself works, such as what an MCP or an edition is, from its help pages: the same pages as its Docs. Pass the question's words. Returns the best matching sections, each with its page and link: answer from them and link the page. For company data, use get_facts.`,
    '',
  ),
} as const
