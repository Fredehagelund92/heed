/**
 * The facts around the Norway story (docs/design/demo-world.md), written by hand. They're the
 * facts people meet on its path: orders and the Sales domain, and Norway and Spain, the two
 * markets it asks about. Each one replaces the words of a generated fact (by id) and keeps
 * everything else (its title, kind, domain, dates and where it applies), so the library, the test
 * questions and the golden set stay the same. Every name, market and address is invented; an
 * `.example` address never resolves.
 *
 * None of them answers the show's two questions (orders in Norway or Spain in October
 * 2026), and the test questions and the golden set name none of them.
 */
export type StoryFact = {
  summary: string
  /** A guide's text. */
  body?: string
  /** What not to conclude, in the writer's words. */
  notToConclude: string
  source: { url: string; quote: string }
}

export const storyFacts: Readonly<Record<string, StoryFact>> = {
  // Orders, in the Sales domain.

  // Payment provider switched in France on 12 May 2026
  itm_spe2w9kh: {
    summary:
      "We moved France's card and bank payments to a new provider on 12 May 2026. For the first week some orders were booked twice, and finance took them out again on 19 May.",
    notToConclude:
      "Higher orders in France from 12 to 18 May 2026 don't mean customers ordered more.",
    source: {
      url: 'https://wiki.example/payments/france-provider-change',
      quote:
        'Duplicate settlement records from 12 to 18 May will be reversed in the 19 May settlement file.',
    },
  },
  // Online sales to the Netherlands stopped on 13 February 2026
  itm_inptukz0: {
    summary:
      'The Netherlands customs office stopped all online sales to the Netherlands on 13 February 2026 while it wrote new import rules. Online sales started again on 25 September 2026. Webshop orders there are close to zero for those months.',
    notToConclude:
      "Low orders in the Netherlands from February to September 2026 don't mean customers left for good.",
    source: {
      url: 'https://customs.example/netherlands/notices/2026-02-13',
      quote:
        'Parcels from webshops outside the Netherlands are held at the border from 13 February 2026 until the new import rules apply.',
    },
  },
  // Orders is reported in local currency before conversion
  itm_ht2sze1q: {
    summary:
      "We report Poland orders in Poland crowns until they're converted. Convert them to euros at the rate of the day before you add Poland to other markets.",
    notToConclude: 'A rise in Poland orders in euros can be the exchange rate, not customers.',
    source: {
      url: 'https://wiki.example/data/definitions/orders',
      quote: 'Poland amounts are stored in crowns. Conversion to euros happens in reporting.',
    },
  },
  // What to rule out before explaining a jump in Orders
  itm_2a1wp53q: {
    summary:
      'Before you explain a jump in France orders, check the file dates. The provider sends weekend files together on Monday, and most jumps are those late files, not customers.',
    body: [
      'Before you explain a jump in orders in France, rule out the data first.',
      '1. Late files: the payment provider sends weekend files together on Monday morning.\n2. Double bookings: after a change of provider, some orders can be booked twice.\n3. Refunds: a large order can be refunded days later.',
      'Then look for a reason in the business, such as a campaign, a sale weekend or a holiday. Compare with a market that had none of them, and ask the owner of the domain before you share it.',
    ].join('\n\n'),
    notToConclude: "A Monday jump in France orders isn't real until you've checked the file dates.",
    source: {
      url: 'https://wiki.example/payments/france-provider-files',
      quote: 'Files not sent over the weekend follow together on Monday morning.',
    },
  },
  // Data for Orders before 19 January 2026 is not reliable
  itm_r6lyl1pc: {
    summary:
      'Sweden orders before 19 January 2026 come from the old payment report, which left out bank transfers. Use Sweden orders from 19 January 2026, and compare them only with later months.',
    notToConclude:
      "Sweden orders didn't jump in January 2026. The report started counting bank transfers.",
    source: {
      url: 'https://wiki.example/data/changelog/2026-01-19',
      quote: 'Bank transfer payments are not included in this report.',
    },
  },
  // Orders lags by one day in the source tool
  itm_0tmqp7o1: {
    summary:
      "Germany's payment files reach Cube the morning after, so yesterday's orders are always short. Leave out the last day when you compare Germany weeks.",
    notToConclude: "A low last day for Germany orders isn't a drop.",
    source: {
      url: 'https://wiki.example/data/freshness',
      quote: 'Germany payment files are loaded the following morning at 07:00.',
    },
  },
  // New VAT rate applied in the Netherlands from 16 March 2025
  itm_656tj74e: {
    summary:
      'A VAT rate of 27 percent applied in the Netherlands from 16 March 2025. Parliament set it back to 25 percent from 6 May 2025. We report Netherlands orders before VAT.',
    notToConclude:
      "Lower orders in the Netherlands in spring 2025 aren't proven to come from the new rate.",
    source: {
      url: 'https://tax.example/netherlands/vat-2025',
      quote:
        'A VAT rate of 27 percent applies to sales to customers in the Netherlands from 16 March 2025.',
    },
  },
  // Regulator paused price promotions in Italy on 18 April 2026
  itm_pfet8zj3: {
    summary:
      'The Italy regulator paused all price promotions and discount codes from 18 April to 30 May 2026 while it reviewed them. We gave no welcome discounts in Italy in those weeks.',
    notToConclude: "Lower discount cost in Italy in May 2026 isn't a saving we planned.",
    source: {
      url: 'https://regulator.example/italy/promotions/2026-04-18',
      quote:
        'Price promotions and discount codes in Italy are suspended from 18 April 2026 pending review.',
    },
  },
  // Checklist before you report a change in Gross sales
  itm_92ydkq4p: {
    summary:
      'Before you share a change in gross sales in the Netherlands, check the stop on online sales from 13 February to 24 September 2026 first. Webshop weeks in those months are close to zero.',
    body: [
      'Before you share a change in gross sales in the Netherlands:',
      '1. Check whether the weeks fall in the stop, from 13 February to 24 September 2026.\n2. Make sure the last day is complete. Files from the Netherlands arrive the next morning.\n3. Compare with the same weeks last year, or with a market whose online sales kept going.\n4. Check that every number is in euros.',
      'If a check fails, say so in the report. The owner of the domain can help with the rest.',
    ].join('\n\n'),
    notToConclude:
      "A rise in the Netherlands after 25 September 2026 isn't growth. Online sales had just started again.",
    source: {
      url: 'https://wiki.example/analytics/handbook/before-you-report',
      quote: "Weeks when a market's online sales stopped are left out of year-on-year comparisons.",
    },
  },
  // How to investigate a drop in Orders in Sweden
  itm_5vd4yczf: {
    summary:
      "Before you explain a drop in Sweden orders, check the payment provider's status page, then the bank holidays. Bank transfers stop on Sweden's eleven public holidays.",
    body: [
      'Sweden orders drop for a few known reasons, and most of them are in the data, not the business.',
      "1. Check the payment provider's status page for the dates. A card outage lasts hours, but it shows in a whole day's total.\n2. Check the bank holiday calendar. Bank transfers stop on Sweden holidays.\n3. Compare with a market that uses the same provider.",
      'If none of these fit, write down what you found and ask the owner of the domain.',
    ].join('\n\n'),
    notToConclude: "One low day in Sweden isn't a trend.",
    source: {
      url: 'https://wiki.example/analytics/handbook/sweden-orders',
      quote: 'Bank transfers are not processed on Sweden public holidays.',
    },
  },
  // What explains the movement of Orders in March 2025?
  itm_43s2i870: {
    summary:
      'What explains the movement of Orders in March 2025? In Mexico they were 12 percent higher than in February, most of it in the last week. A good answer names the spring sale from 28 to 30 March as the only event written down, and claims no more.',
    notToConclude: "The spring sale isn't proven to be why orders rose.",
    source: {
      url: 'https://wiki.example/analytics/good-answers/mexico-orders-march-2025',
      quote: 'The Mexico spring sale runs from 28 to 30 March 2025.',
    },
  },

  // Norway and Spain.

  // Regulator paused price promotions in Norway on 9 May 2026
  itm_za26xpzv: {
    summary:
      "The Norway regulator paused all price promotions on 9 May 2026 while it writes new pricing rules. Our Norway campaigns were all price promotions, so we haven't run a paid campaign there since.",
    notToConclude:
      "Missing return on ad spend in Norway since May 2026 doesn't mean our campaigns there failed.",
    source: {
      url: 'https://regulator.example/norway/promotions/2026-05-09',
      quote:
        'With effect from 9 May 2026, no retailer may advertise price reductions in Norway until the new code takes effect.',
    },
  },
  // Units sold excludes test accounts
  itm_s90n5xps: {
    summary:
      'Units sold in Norway leaves out the 312 accounts our teams use to test the webshop. From 29 May 2026 the test accounts of the new app are left out too.',
    notToConclude: "Norway units sold didn't fall on 29 May 2026. Test orders stopped counting.",
    source: {
      url: 'https://wiki.example/data/definitions/units-sold',
      quote: 'Accounts with the internal flag are removed from all units sold figures.',
    },
  },
  // Returns changed definition on 28 April 2026
  itm_ra39ow6c: {
    summary:
      "From 28 April 2026, Norway returns count only refunds that reached the customer's bank. Cancelled refunds counted before, so earlier weeks read about 4 percent higher.",
    notToConclude:
      "The drop in Norway returns at the end of April 2026 isn't a change in what customers did.",
    source: {
      url: 'https://wiki.example/data/changelog/2026-04-28',
      quote:
        'Returns are recognised when the bank confirms the refund. Cancelled refunds are excluded.',
    },
  },
  // Payment provider switched in Norway on 9 July 2025
  itm_kh4llvi9: {
    summary:
      'We moved Norway payments to a new provider on 9 July 2025, and customers had to add their cards again. Support contacts about payments stayed high until 15 December 2025.',
    notToConclude:
      "More support contacts in Norway in autumn 2025 don't mean customers were unhappy with our gear.",
    source: {
      url: 'https://wiki.example/payments/norway-provider-change',
      quote:
        'Customers in Norway will be asked to register their payment card again at their next order.',
    },
  },
  // Norway launch campaign started on 24 March 2026
  itm_eprlkrz2: {
    summary:
      'Marketing started the Norway spring campaign on 24 March 2026. Its ads stopped on 9 May 2026, when the regulator paused price promotions, and its budget is held until 19 November 2026.',
    notToConclude:
      "Return on ad spend in Norway after 9 May 2026 isn't the campaign's result. Its ads weren't running.",
    source: {
      url: 'https://wiki.example/marketing/campaigns/norway-spring-2026',
      quote: 'Norway spring campaign: live 24 March 2026. Budget committed until 19 November 2026.',
    },
  },
  // On-time shipping rate changed definition on 24 May 2026
  itm_x3yuzamx: {
    summary:
      'From 24 May 2026, a Norway order counts as on time only when it leaves the warehouse on the day it was promised. The next day was enough before, so earlier months read higher.',
    notToConclude: "The lower on-time rate in Norway from late May 2026 isn't slower packing.",
    source: {
      url: 'https://wiki.example/data/changelog/2026-05-24',
      quote: 'An order is on time when it leaves the warehouse on the promised day.',
    },
  },
  // What to rule out before explaining a jump in Online share
  itm_vk61zln1: {
    summary:
      "Before you explain a jump in online share in Norway, check the supply team's log for gaps in the store stock feed. Big sale days lift the share too.",
    body: [
      'Online share in Norway jumps on big sale days. It also jumps when store stock is missing from the feed, and that has nothing to do with customers.',
      "1. Check the supply team's log for gaps in the store stock feed.\n2. Check the sale calendar for Black Friday or a clearance.\n3. Compare with a market that ran the same sale.",
      "If you still can't explain the jump, ask the owner of the domain.",
    ].join('\n\n'),
    notToConclude: "A jump in online share isn't proof that customers prefer the webshop.",
    source: {
      url: 'https://wiki.example/supply/stock-feed-log',
      quote:
        'Store stock levels were unavailable from 14:00 to 19:30 while the stock feed was restored.',
    },
  },
  // What to rule out before explaining a jump in Gross margin
  itm_kcy22j54: {
    summary:
      'Before you explain a jump in gross margin in Spain, look at four weeks or more. Margin there swings with clearance sales, so one good weekend for us is no trend.',
    body: [
      'Gross margin is the share of net revenue we keep after what the goods cost us. In Spain it swings with clearance sales more than anywhere else.',
      "1. Look at four weeks or more, never one weekend.\n2. Check for a few very large orders. One big order at full price can lift a week's margin.\n3. Compare with the average order value for the same weeks.",
      'Compare with another market over the same weeks, then talk to the owner of the domain.',
    ].join('\n\n'),
    notToConclude: "A high margin in Spain for one week isn't better pricing.",
    source: {
      url: 'https://wiki.example/merchandising/margin-by-market',
      quote:
        'Weekly gross margin in Spain has ranged from 38 to 55 percent over the last two seasons.',
    },
  },
  // Comparing Average order value between Spain and other markets
  itm_2teger45: {
    summary:
      'Before you compare average order value in Spain with other markets, know that Spain charges import duty on any online order over 500 euros. Compare Spain with itself over time, or with markets that have the same limit.',
    body: [
      'Spain charges import duty on any online order over 500 euros. Most other markets have no such limit, and a few large orders lift their average.',
      '1. Compare Spain with itself over time.\n2. If you need another market, leave out its orders over 500 euros first.\n3. Look at the median order as well as the average.',
      'The owner of the domain has the list of markets with a similar limit.',
    ].join('\n\n'),
    notToConclude: "Smaller orders in Spain don't mean customers there are worth less.",
    source: {
      url: 'https://customs.example/spain/duty-limits',
      quote: 'Import duty applies to any online order over 500 euros.',
    },
  },
  // Payment provider switched in Spain on 21 October 2025
  itm_m84x8rur: {
    summary:
      "Spain payments moved to a new provider on 21 October 2025. It records a first order on the day it's approved, not the day it's made, so first-time buyers land a day later than before.",
    notToConclude:
      "Fewer first-time buyers in Spain on 21 October 2025 isn't fewer new customers. They moved to the next day.",
    source: {
      url: 'https://wiki.example/payments/spain-provider-change',
      quote: 'Orders are reported on the day of approval.',
    },
  },
  // New VAT rate applied in Norway from 3 August 2025
  itm_7ini5esz: {
    summary:
      'A new VAT rule applied in Norway from 3 August 2025 to 5 June 2026 and taxed discounts as part of the price. We cut welcome discounts in Norway in that time, and discount cost there is lower for those months.',
    notToConclude:
      "Lower conversion in Norway in those months isn't proven to come from the smaller discounts.",
    source: {
      url: 'https://tax.example/norway/vat/2025-08-03',
      quote: 'From 3 August 2025, discounts given to customers are part of the taxable price.',
    },
  },
  // Which markets drove the change in New customers, with Spain as the baseline?
  itm_smcntshq: {
    summary:
      'Which markets drove the change in New customers, with Spain as the baseline? A good answer lists the three markets that moved most against Spain over the same weeks. It leaves out the Netherlands, where online sales had stopped, and says so.',
    notToConclude: "A market that moved more than Spain isn't doing better by that alone.",
    source: {
      url: 'https://wiki.example/analytics/good-answers/new-customers-by-market',
      quote:
        'Use Spain as the baseline: it had no stops, campaigns or rule changes in the first half of 2026.',
    },
  },
  // New customers lags by one day in the source tool
  itm_p9lchmy0: {
    summary:
      "New customers in Spain reach Cube the morning after they sign up. Yesterday's count is short until about 10:00, so leave out the last day when you compare weeks.",
    notToConclude: "A low count for yesterday isn't a drop in sign-ups.",
    source: {
      url: 'https://wiki.example/data/freshness',
      quote: 'Spain sign-ups are loaded in the nightly batch and complete by 10:00 the next day.',
    },
  },
}
