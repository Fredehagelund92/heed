/**
 * The connectors an admin may add a source of, as the service lists them: the built-in
 * interface 3 connectors from their manifests (src/connectors/manifests.ts), then the Cube type
 * written to interface 2 (src/server/modules/connectors/cube.ts) through the same adapter. The
 * mock answers `sources.types` with these, and the conformance suite
 * (tests/conformance/context-api-settings.ts) holds both to the same list and form.
 */
import {
  manifestFromInterface2,
  type Interface2Declaration,
} from '../../domain/connector-manifest.ts'
import type { ConnectorListing } from '../../contract/sources.ts'
import { builtInManifests } from '../../connectors/manifests.ts'
import { productName } from '../lib/brand.ts'

/** The Cube type's declaration, as the service has it. */
export const mockCubeDeclaration: Interface2Declaration = {
  type: 'cube',
  tool: 'Cube',
  title: 'Cube model in a Git repository',
  description:
    'Reads the YAML model files of a Cube project from a Git repository every hour, at the branch, tag or commit you name. We keep names, short descriptions and change marks, never a calculation or data.',
  access: [
    'Read access to this one repository. We never write to it.',
    'We read only the model files, never a Cube server, a warehouse or data.',
  ],
  fields: [
    {
      key: 'repository',
      kind: 'address',
      label: 'Repository',
      description: 'The https address of the Git repository that holds the model.',
      required: true,
      placeholder: 'https://git.example.com/analytics/semantic-layer.git',
      initial: null,
    },
    {
      key: 'ref',
      kind: 'text',
      label: 'Branch, tag or commit',
      description:
        'We read the model as it is there. A tag or a commit stays the same, and a branch moves with each change.',
      required: true,
      placeholder: null,
      initial: 'main',
    },
    {
      key: 'folder',
      kind: 'text',
      label: 'Model folder',
      description:
        'The folder of model files in the repository, such as model or cube/model. Leave it empty when they are at the top.',
      required: false,
      placeholder: null,
      initial: null,
    },
    {
      key: 'token',
      kind: 'secret',
      label: 'Read-only token',
      description:
        'A token that can read this repository and nothing else. We keep it in a secret store and never show it again. Leave it empty for a public repository.',
      required: false,
      placeholder: null,
      initial: null,
    },
    {
      key: 'username',
      kind: 'text',
      label: 'User name for the token',
      description:
        'Some Git hosts ask for a user name with the token, and most accept any. If you leave it empty, we send x-access-token.',
      required: false,
      placeholder: null,
      initial: null,
    },
    {
      key: 'modelUrl',
      kind: 'address',
      label: 'Model folder address',
      description:
        'The model folder in the Git host’s web view, so each view links to its file. We never open it.',
      required: false,
      placeholder: 'https://git.example.com/analytics/semantic-layer/tree/main/model',
      initial: null,
    },
    {
      key: 'domainNames',
      kind: 'domain_names',
      label: 'Domain names',
      description: `When the model’s meta.domain names a domain differently, choose the ${productName} domain it means. A name that is already a ${productName} domain id needs no line.`,
      required: false,
      placeholder: null,
      initial: null,
    },
  ],
  secretsBoundTo: ['repository'],
}

export const mockConnectorListings: ConnectorListing[] = [
  ...builtInManifests.map((manifest) => ({ writtenTo: 3, manifest })),
  { writtenTo: 2, manifest: manifestFromInterface2(mockCubeDeclaration) },
]
