import { withWhen, type Fact } from '@/model/items'
import { factById } from './world'

/** What a Not found card drafts: an item the owner reviews, edits and publishes like any suggestion. */
export const spainDraft: Fact = withWhen({
  id: 'itm_spain_payments',
  title: 'Card payments in Spain failed from 14 to 16 October 2026',
  summary:
    'Card payments failed for most webshop orders in Spain from 14 to 16 October 2026, so orders there fell for those three days.',
  body: 'Orders in Spain were back to normal on 17 October 2026.',
  domain: 'sales',
  kind: 'event',
  where: ['Orders', 'Spain'],
  valid: { from: '2026-10-14', until: '2026-10-16' },
  status: 'Live',
  checkedBy: 'Jon Abara',
  checkedOn: '23 Oct 2026',
  source: 'https://status.payments.example/incidents/2026-10-14-spain',
  quote:
    'Card authorisations for merchants in Spain failed intermittently between 14 and 16 October 2026.',
  dontConclude: 'Fewer orders in Spain on 14 to 16 October do not mean customers lost interest.',
})

/**
 * What "Draft from text" makes of any pasted text in the demo: the Norway stop, every field marked
 * for the writer to check. In Heed the assistant drafts it, or a rule reader of dates and names.
 */
export const norwayDraft: Fact = { ...factById('itm_norway_stop')!, id: 'draft', status: 'Draft' }
