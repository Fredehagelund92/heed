/**
 * Heed's help pages (docs/old-help) for the service: read once at start through the page model the
 * Docs area uses, and searched by search_help for the assistant and for agents over MCP.
 */
export { readHelpLibrary, repositoryHelp, helpFolderPath, type HelpLibrary } from './library.ts'
export { helpAnswer, HELP_RESULTS, HELP_TEXT_MAX } from './answer.ts'
