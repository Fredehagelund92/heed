import { DEFINITIONS_TOOL } from '@/model/integrations'
import { ruleWords, type AlertSettings, type Raised, type Rule, type RuleId } from '@/model/alerts'
import type { DomainId } from '@/model/items'

// The demo world's alert rules and what they raised lately, and the mock's record of what people
// changed, kept until the page reloads. The rules' sentences are the domain's, as the service's are.

export const RULES: Rule[] = [
  {
    ...ruleWords('gap'),
    last: 'Today, Orders in Germany',
    lastHref: '/inbox?card=gap-germany',
    lastDomain: 'sales',
  },
  {
    ...ruleWords('saved'),
    last: 'Today, 2 questions',
    lastHref: '/inbox?card=look-sales',
    lastDomain: 'sales',
  },
  {
    ...ruleWords('disagree'),
    last: 'Tue 20 Oct',
    lastHref: '/inbox?card=alert-net-revenue',
    lastDomain: 'sales',
  },
  {
    ...ruleWords('share'),
    last: 'Never',
  },
  {
    ...ruleWords('fail'),
    last: 'Never',
  },
  {
    ...ruleWords('spend'),
    last: 'Never',
  },
  {
    ...ruleWords('sync'),
    last: 'Fri 9 Oct',
    lastHref: '/settings/integrations/cube',
  },
  {
    ...ruleWords('due'),
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
    href: '/inbox?card=alert-net-revenue',
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
