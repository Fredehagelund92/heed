import type { Area } from '../../../domain/item.ts'
import type { Queryable } from '../../db/database.ts'

/** Areas with what they are (summary and description) and their current owners. */
export interface AreasService {
  list(): Promise<Area[]>
}

export function createAreasService(database: Queryable): AreasService {
  return {
    list: () =>
      database.query<Area>(
        `select a.id, a.name, a.summary, a.description, a.label, a.revision,
                array(select x.person_id::text from area_assignments x
                       where x.area_id = a.id and x.role = 'owner' and x.valid_at @> now()
                       order by lower(x.valid_at), x.person_id) as "ownerIds"
           from areas a
          where a.archived_at is null
          order by a.name collate "en-x-icu", a.id collate "C"`,
      ),
  }
}
