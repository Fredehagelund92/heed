// Not allowed: the command line tool goes through the contract, not the service.
import { describeAlpha } from '../server/modules/alpha'

export const cli = describeAlpha()
