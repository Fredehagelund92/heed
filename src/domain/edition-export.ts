/**
 * An edition as one canonical JSON document (NFR-045, NFR-093): every item version in service
 * with its mention markup and mention rows, the vocabulary terms, the area states, the domains the
 * definition source gave terms and the stored digests. `verifyEditionExport` recomputes the digests from the content, so anyone can
 * check an export offline.
 */
import { contentDigest, editionDigest } from './canonical.ts'
import { type ItemVersion, itemVersionDigests } from './item-version.ts'
import type { AreaState } from './item.ts'
import { termDigestContent, type Term } from './vocabulary.ts'

export const EDITION_EXPORT_FORMAT = 'heed.edition/1'

/** One item version as served, flat so that the file reads back as an import. */
export type ExportedItem = ItemVersion & { id: string; version: number; digest: string }
/** A vocabulary term version; the digest covers exactly these fields. */
export type ExportedTerm = {
  key: string
  kind: Term['kind']
  parentKey: string | null
  name: string
  aliases: string[]
  areaId: string | null
  /** The source members it names (CON-208). An export made before a term named several has `definitionRef`. */
  definitionRefs: string[]
  digest: string
}
export type EditionExport = {
  format: typeof EDITION_EXPORT_FORMAT
  edition: {
    seq: number
    label: string
    reason: string
    note: string | null
    restores: string | null
    createdAt: string
    sealedAt: string
  }
  /** The digest the edition was sealed with. */
  digest: string
  items: ExportedItem[]
  /**
   * Versions this export may not show its reader, by the audience rule: one for some groups only,
   * or one that names such an item. Their digests only, so the edition digest still checks.
   */
  withheld: { id: string; digest: string }[]
  vocabulary: ExportedTerm[]
  areas: { id: string; state: AreaState }[]
  /**
   * The domain the definition source gave each term in the edition (CON-206): with the
   * vocabulary's areas, the edition's area map. Absent in exports made before it was kept.
   */
  domains?: { key: string; areaId: string }[]
}

export type ExportCheck = {
  /** The edition digest recomputed from the listed digests equals the stored one. */
  edition: boolean
  /** Items whose content does not give their listed digest. */
  items: string[]
  /** Terms whose content does not give their listed digest. */
  vocabulary: string[]
}

export async function verifyEditionExport(document: EditionExport): Promise<ExportCheck> {
  const items: string[] = []
  for (const item of document.items) {
    // An export made before the rename (0086) names the owner `stewardId`.
    const {
      id,
      version: _number,
      digest,
      stewardId,
      ...content
    } = item as ExportedItem & { stewardId?: string }
    if (stewardId !== undefined && content.ownerId === undefined) content.ownerId = stewardId
    const computed = await itemVersionDigests(content).then(
      (digests) => digests.content,
      () => null,
    )
    if (computed !== digest) items.push(id)
  }
  const vocabulary: string[] = []
  for (const { digest, ...term } of document.vocabulary) {
    const { definitionRef, definitionRefs, ...rest } = term as typeof term & {
      definitionRef?: string | null
    }
    const content = termDigestContent({
      ...rest,
      definitionRefs: definitionRefs ?? (definitionRef ? [definitionRef] : []),
    })
    if ((await contentDigest(content)) !== digest) vocabulary.push(term.key)
  }
  const edition =
    (await editionDigest({
      items: [...document.items, ...document.withheld].map(({ id, digest }) => ({ id, digest })),
      vocabulary: document.vocabulary.map(({ key, digest }) => ({ key, digest })),
      areas: document.areas,
      domains: document.domains ?? [],
    }).catch(() => null)) === document.digest
  return { edition, items, vocabulary }
}
