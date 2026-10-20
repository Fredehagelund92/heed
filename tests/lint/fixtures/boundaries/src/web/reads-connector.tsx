// Allowed: the manifest, which is data. Not allowed: the runtime, which the service runs.
import { manifest } from '../connectors/sample/manifest'
import { answer } from '../connectors/sample/runtime'

export const shown = `${manifest.id} ${answer}`
