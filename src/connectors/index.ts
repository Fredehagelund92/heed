import { defineConnector, type ConnectorModule } from '../domain/connector-runtime.ts'
import { manifest as cube } from './cube/manifest.ts'
import { runtime as cubeRuntime } from './cube/runtime.ts'
import { manifest as gitMarkdown } from './git-markdown/manifest.ts'
import { runtime as gitMarkdownRuntime } from './git-markdown/runtime.ts'
import { manifest as staticDefinitions } from './static-definitions/manifest.ts'
import { runtime as staticDefinitionsRuntime } from './static-definitions/runtime.ts'

/**
 * The connectors built into this repository, one folder each, with their manifest, their runtime
 * (interface 3.0) and the worker a runtime hands risky parsing to, if it has one. Server only: the
 * web app reads `manifests.ts`. A test fails when a folder here is not listed, or when this list
 * and `manifests.ts` differ.
 */
export const builtInConnectors: readonly ConnectorModule[] = [
  defineConnector(cube, cubeRuntime, { worker: new URL('./cube/worker.ts', import.meta.url) }),
  defineConnector(staticDefinitions, staticDefinitionsRuntime),
  defineConnector(gitMarkdown, gitMarkdownRuntime),
]
