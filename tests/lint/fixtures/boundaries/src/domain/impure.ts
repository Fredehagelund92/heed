// Not allowed: the domain reaching for the service, a driver, the clock and the network.
import { Pool } from 'pg'
import { app } from '../server/app'

export const pool = new Pool()
export const now = Date.now()
export const today = new Date()
export const answer = fetch(app)
