/**
 * The connectors an admin may add a source of, as the service lists them: the built-in
 * connectors from their manifests (src/connectors/manifests.ts), each written to interface 3.
 * The mock answers `sources.types` with these, and the conformance suite
 * (tests/conformance/context-api-settings.ts) holds both to the same list and form.
 */
import type { ConnectorListing } from '../../contract/sources.ts'
import { builtInManifests } from '../../connectors/manifests.ts'

export const mockConnectorListings: ConnectorListing[] = builtInManifests.map((manifest) => ({
  writtenTo: 3,
  manifest,
}))
