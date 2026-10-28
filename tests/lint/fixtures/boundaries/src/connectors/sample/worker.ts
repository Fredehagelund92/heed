// A connector's worker (T1) may load the packages it parses with, but never the service.
import { parseDocument } from 'yaml'
import { app } from '../../server/app'

export const parsed = parseDocument(String(app))
process.send?.(parsed.toJS())
