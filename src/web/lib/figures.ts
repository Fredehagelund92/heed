import type { FigureTryFailure } from '@contract/figures'
import { useSettings, useWrite } from '@/api/queries'
import type { ConnectorId } from '@/model/integrations'

// Whether Ask shows figures, per integration: off by default (Ask then links into the source),
// switched on by an admin on the integration's page, with who to ask about its data.

export type FigureSettings = {
  enabled: (id: ConnectorId) => boolean
  contact: (id: ConnectorId) => string
}

/** The figure settings as they stand (the mock applies its ?figures= review flag). */
export function useFigures(): FigureSettings {
  const { figures, contacts } = useSettings()
  return {
    enabled: (id) => figures[id] ?? false,
    contact: (id) => contacts[id] ?? 'the data team',
  }
}

/**
 * Switching figures on or off for an integration, naming its data contact, and setting where its
 * figures are read. Each says when it is done, or why it failed.
 */
export function useFigureActions() {
  const write = useWrite()
  return {
    setFigures: (source: ConnectorId, on: boolean) => write('setFigures', { source, on }),
    setDataContact: (source: ConnectorId, name: string) =>
      write('setDataContact', { source, name }),
    setConnection: (source: ConnectorId, endpoint: string, token: string) =>
      write('setFigureConnection', { source, endpoint, token }),
  }
}

/**
 * Why Try a figure read nothing, in words: what happened, and what to do about it. Only the code
 * comes from the service, never what the tool said.
 */
export function tryFailureWords(
  failure: FigureTryFailure,
  tool: string,
): { title: string; fix: string } {
  switch (failure) {
    case 'not_set_up':
      return {
        title: "Figures aren't set up yet",
        fix: 'Set up figures with the data endpoint and a read-only token, then try again.',
      }
    case 'no_measure':
      return {
        title: `No view in ${tool} has a measure and exactly one date`,
        fix: 'There is nothing to read a figure from yet. Give a view one time dimension, then try again.',
      }
    case 'unauthorized':
      return {
        title: `${tool} refused the token`,
        fix: `Check that it can read ${tool}'s data API, then replace it.`,
      }
    case 'not_found':
      return {
        title: 'Nothing answered at this address',
        fix: 'Check the data endpoint, then set it up again.',
      }
    case 'rate_limited':
      return { title: `${tool} asked to slow down`, fix: 'Try again in a minute.' }
    case 'unreachable':
      return {
        title: `Couldn't reach ${tool}`,
        fix: 'Check the data endpoint and that the server is running, then try again.',
      }
    case 'timed_out':
      return {
        title: 'No answer within 4 seconds',
        fix: `${tool} may be busy. Try again in a minute.`,
      }
    case 'private_address':
      return {
        title: "This address isn't public",
        fix: 'Figures are read only from an https address on a public host. Check the data endpoint.',
      }
    case 'invalid_output':
      return {
        title: `${tool} answered in a way that couldn't be read`,
        fix: "Check that the data endpoint is the data API's address for a query.",
      }
  }
}
