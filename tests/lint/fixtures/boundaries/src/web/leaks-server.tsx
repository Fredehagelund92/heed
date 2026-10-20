// Not allowed: the front end importing the service or a service-only package.
import { Pool } from 'pg'
import { app } from '../server/app'
import { addDays } from '../domain/pure'

export const leaked = `${app} ${addDays('2026-10-07')}`
export const pool = new Pool()
