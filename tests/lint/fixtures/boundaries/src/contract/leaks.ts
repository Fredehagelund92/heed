// Not allowed: the contract may import the domain only.
import { addDays } from '../domain/pure'
import { app } from '../server/app'

export const contract = `${addDays('2026-10-07')} ${app}`
