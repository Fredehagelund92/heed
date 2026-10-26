import { DEFINITIONS_TOOL } from '@/model/integrations'
import type { AlertSettings, Raised, Rule, RuleId } from '@/model/alerts'
import type { DomainId } from '@/model/items'

// The demo world's alert rules and what they raised lately, and the mock's record of what people
// changed, kept until the page reloads.

export const RULES: Rule[] = [
  {
    id: 'gap',
    name: 'Not found',
    when: '{n} or more times in 7 days about the same thing, even across a month edge',
    then: 'A Not found card to the owners',
    audience: 'owners',
    threshold: { value: '5', choices: ['3', '5', '10'], setting: 'gaps.no_item_threshold' },
    last: 'Today, Orders in Germany',
    lastHref: '/inbox?card=gap-germany',
    lastDomain: 'sales',
  },
  {
    id: 'saved',
    name: 'A saved question needs a look',
    when: 'After a publish, an archive, a restore, a sync, or a check date passing',
    then: 'A card to the owners of the domain',
    audience: 'owners',
    last: 'Today, 2 questions',
    lastHref: '/inbox?card=look-sales',
    lastDomain: 'sales',
  },
  {
    id: 'disagree',
    name: 'Conflict',
    when: 'Two items that apply say different things, asked {n} or more times',
    then: 'A card to the owners',
    audience: 'owners',
    isNew: true,
    threshold: { value: '3', choices: ['2', '3', '5'] },
    last: 'Tue 20 Oct',
    lastHref: '/observability/questions?dock=topic.net-revenue-norway',
    lastDomain: 'sales',
  },
  {
    id: 'share',
    name: 'More questions not found',
    when: "More than {n} of a day's questions, two days running",
    then: 'A line on Overview and a card to admins',
    audience: 'admins',
    isNew: true,
    threshold: { value: '20%', choices: ['10%', '20%', '30%'] },
    last: 'Never',
  },
  {
    id: 'fail',
    name: 'Calls fail',
    when: "More than {n} of a day's calls could not be read or failed",
    then: 'A card to admins',
    audience: 'admins',
    isNew: true,
    threshold: { value: '5%', choices: ['2%', '5%', '10%'] },
    last: 'Never',
  },
  {
    id: 'spend',
    name: 'Model spend',
    when: 'Reaches {n} of the monthly cap',
    then: 'A card to admins',
    audience: 'admins',
    isNew: true,
    threshold: { value: '80%', choices: ['50%', '80%', '100%'] },
    last: 'Never',
  },
  {
    id: 'sync',
    name: 'A connected tool did not sync',
    when: 'A read failed or is overdue',
    then: 'A card to admins and the owners',
    audience: 'both',
    last: 'Fri 9 Oct',
    lastHref: '/settings/integrations/cube',
  },
  {
    id: 'due',
    name: 'A check is due',
    when: 'A check date is reached',
    then: 'A reminder to the owner at 07:00',
    audience: 'owners',
    last: 'Today, 2 items',
    lastHref: '/inbox?card=check-returns',
    lastDomain: 'sales',
    lastIn: { marketing: { last: 'Fri 18 Sep, 1 item', href: '/inbox?card=check-italy' } },
  },
]

export const RAISED: Raised[] = [
  {
    id: 'r-look',
    rule: 'saved',
    title: '2 saved questions need a look',
    line: 'One after Payment provider switched in Norway was archived, one after a check date passed. A card went to Jon Abara and Sofia Brandt.',
    when: 'Today, 09:41',
    domain: 'sales',
    href: '/inbox?card=look-sales',
  },
  {
    id: 'r-germany',
    rule: 'gap',
    title: 'Orders in Germany: not found, 6 times across a month edge',
    line: '3 calls about 30 October and 3 about 1 November, counted together. A Not found card went to Jon Abara and Sofia Brandt.',
    when: 'Today, 06:20',
    domain: 'sales',
    href: '/inbox?card=gap-germany',
  },
  {
    id: 'r-spain',
    rule: 'gap',
    title: 'Orders in Spain: not found, 9 times',
    line: 'A Not found card went to Jon Abara and Sofia Brandt.',
    when: 'Today, 06:05',
    domain: 'sales',
    href: '/inbox?card=gap-spain',
  },
  {
    id: 'r-net-revenue',
    rule: 'disagree',
    title: 'Net revenue in Norway: conflict, 3 times',
    line: 'A card went to Jon Abara and Sofia Brandt.',
    when: 'Tue 20 Oct',
    domain: 'sales',
    href: '/observability/questions?dock=topic.net-revenue-norway',
  },
  {
    id: 'r-cube',
    rule: 'sync',
    title: `${DEFINITIONS_TOOL} did not sync`,
    line: 'A card went to the admins. It synced again at 06:00.',
    when: 'Fri 9 Oct',
    href: '/settings/integrations/cube',
  },
  {
    id: 'r-italy',
    rule: 'due',
    title: 'Regulator paused price promotions in Italy: its check date passed',
    line: 'A reminder went to Tomas Eriksen at 07:00.',
    when: 'Fri 18 Sep',
    domain: 'marketing',
    href: '/inbox?card=check-italy',
  },
]

export function createAlerts() {
  let settings: AlertSettings = { off: [], muted: {}, thresholds: {} }
  return {
    read: () => ({ rules: RULES, raised: RAISED, settings }),
    /** An admin turns a rule on or off for everyone. */
    setOn(id: RuleId, on: boolean) {
      settings = {
        ...settings,
        off: on ? settings.off.filter((x) => x !== id) : [...settings.off, id],
      }
    },
    /** An owner mutes a rule for their domains: its cards stop reaching them, not anyone else. */
    setMuted(id: RuleId, domains: DomainId[], muted: boolean) {
      const was = settings.muted[id] ?? []
      settings = {
        ...settings,
        muted: {
          ...settings.muted,
          [id]: muted
            ? [...new Set([...was, ...domains])]
            : was.filter((d) => !domains.includes(d)),
        },
      }
    },
    setThreshold(id: RuleId, value: string) {
      settings = { ...settings, thresholds: { ...settings.thresholds, [id]: value } }
    },
  }
}
