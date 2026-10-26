import type { DomainId } from '@/model/items'
import type { SavedQuestion } from '@/model/saved-questions'

// Saved questions: a question an owner keeps, with the answer it should get. After every change
// that can move an answer (a publish, an archive, a restore, a sync, or a check date passing) each
// one is checked again, for free and the same way every time: it checks what agents get, not how an
// agent words it. The result is Same, Changed (the answer moved, not worse) or Needs a look (worse).
//
// One source for every count of them: the Overview cell, Quality, the domain page's health line and
// the sidebar's badge all read this list, so they can never disagree.

const seed: SavedQuestion[] = [
  {
    id: 'sq-support-norway',
    question: 'Why did support contacts in Norway rise in autumn 2025?',
    domain: 'sales',
    savedBy: 'Jon Abara',
    expect: 'Checked: the payment provider switch in Norway on 9 July 2025.',
    result: 'look',
    why: 'Used to answer from 1 item. Now it says nothing is written down.',
    when: 'Today, 09:41',
    factId: 'itm_kh4llvi9',
    diff: {
      saved:
        'We moved Norway payments to a new provider on 9 July 2025, and customers had to add their cards again.',
      now: 'Not found. The item it answered from is archived.',
    },
  },
  {
    id: 'sq-gross-margin',
    question: 'What should I rule out before explaining a jump in gross margin?',
    domain: 'sales',
    savedBy: 'Sofia Brandt',
    expect: 'Checked: the guide for a jump in gross margin.',
    result: 'look',
    why: 'The item it answers from has a check date that passed.',
    when: 'Today, 07:00',
    factId: 'itm_kcy22j54',
    diff: {
      saved: 'Checked: What to rule out before explaining a jump in Gross margin.',
      now: 'Outdated: the same item, its check date passed on 22 Oct.',
    },
  },
  {
    id: 'sq-norway-august',
    question: 'Why did orders in Norway drop in August?',
    domain: 'sales',
    savedBy: 'Jon Abara',
    expect: 'Checked: the customs stop on 4 August 2026.',
    result: 'changed',
    why: 'The sentence agents get has new words. Still based on checked context.',
    when: 'Tue 20 Oct',
    factId: 'itm_norway_stop',
    diff: {
      saved: 'A new customs rule stopped online sales to Norway from 4 August 2026.',
      now: 'A new customs rule stopped all online sales to Norway from 4 August 2026, so orders there fell to almost nothing.',
    },
  },
  same(
    'sq-gift-cards',
    'Do Norway orders include gift cards?',
    'sales',
    'Jon Abara',
    'itm_gift_card_only',
  ),
  same(
    'sq-store-credit',
    'Does Norway count store credit in orders?',
    'sales',
    'Sofia Brandt',
    'itm_gift_store_credit',
  ),
  same(
    'sq-early-orders',
    'Can I compare orders from before 19 January 2026?',
    'sales',
    'Jon Abara',
    'itm_r6lyl1pc',
  ),
  same(
    'sq-test-accounts',
    'Do units sold include test accounts?',
    'sales',
    'Sofia Brandt',
    'itm_s90n5xps',
  ),
  same(
    'sq-promotions-norway',
    'Were price promotions paused in Norway in May?',
    'marketing',
    'Tomas Eriksen',
    'itm_za26xpzv',
  ),
  same(
    'sq-vat-norway',
    'Which VAT rate applies in Norway?',
    'marketing',
    'Tomas Eriksen',
    'itm_7ini5esz',
  ),
  same(
    'sq-new-customers',
    "Why are yesterday's new customers short?",
    'customer_value',
    'Noor Haddad',
    'itm_p9lchmy0',
  ),
  same(
    'sq-spain-provider',
    'Did the payment provider change in Spain?',
    'customer_value',
    'Alex Moreau',
    'itm_m84x8rur',
  ),
  same(
    'sq-roas-campaign',
    'How do I read return on ad spend for one campaign?',
    'paid_media',
    'Priya Nair',
    'itm_roas_campaign',
  ),
]

function same(
  id: string,
  question: string,
  domain: DomainId,
  savedBy: string,
  factId: string,
): SavedQuestion {
  return {
    id,
    question,
    domain,
    savedBy,
    expect: 'Checked, from the item it answers from today.',
    result: 'same',
    why: 'Same items, same sentence.',
    when: 'Today, 09:41',
    factId,
  }
}

export { seed as savedSeed }
