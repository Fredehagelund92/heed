// Not allowed: a connector reaching for the service, a package and the network on its own.
import { Pool } from 'pg'
import { app } from '../../server/app'
import { manifest } from './manifest'

export const pool = new Pool()
export const answer = `${app} ${manifest.id}`
export const fetched = fetch(answer)
