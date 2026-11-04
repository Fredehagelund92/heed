import { llmsFiles } from '../../lib/llms.ts'
import { readSettings } from '../../lib/settings.ts'

export const GET = () => new Response(llmsFiles(readSettings(process.env)).index)
