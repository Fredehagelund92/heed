import { contentDigest } from '../../../domain/canonical.ts'
import {
  INTERFACE_VERSION,
  type ConnectorType,
  type DefinitionSource,
  type Definition,
} from './types.ts'

/** Two invented definitions, read when the server is given no model folder. */
export const demoConnectorType: ConnectorType = { type: 'demo', tool: 'Demo', settingKeys: [] }

export function createDemoSource(): DefinitionSource {
  return {
    id: 'demo',
    type: 'demo',
    name: 'Demo definitions',
    interfaceVersion: INTERFACE_VERSION,
    serverSettings: [],
    async read() {
      const members = [
        { ref: 'semlayer:revenue', kind: 'metric' as const, name: 'Revenue', valueType: 'number' },
        {
          ref: 'semlayer:country',
          kind: 'dimension' as const,
          name: 'Country',
          valueType: 'string',
        },
      ]
      const definitions: Definition[] = await Promise.all(
        members.map(async (member) => ({
          ...member,
          title: member.name,
          descriptionCopy: 'Invented demonstration definition.',
          visibleGroups: null,
          areaHint: null,
          domainSource: 'none',
          modelFile: null,
          changeMark: await contentDigest(member),
        })),
      )
      return { sourceVersion: 'demo-v1', complete: true, definitions, warnings: [] }
    },
  }
}
