/*
  Everyday words: words a question uses for how, when, how much or what kind, never as the name of
  a value. A word in no list that sits where a value goes ("orders from jordan") is a value Heed
  does not have, unless it is one of these ("orders from yesterday", "revenue in gbp", "how is the
  mobile team doing"). Lowercase, as normalizeName gives them. A value that has one of these as its
  name is still read by that name: names are read first, and this list only keeps a word from
  being taken for a value Heed does not have.
*/

const words = `
a about above across after again against all almost alone along already also although always am
among an and another any anybody anyone anything anyway anywhere are around as at away back be
because been before behind being below beside besides between beyond both but by can cannot could
did do does doing done down during each either else enough even ever every everybody everyone
everything everywhere except few for from further had has have having he her here hers herself
him himself his how however i if in inside instead into is it its itself just least less like
lot lots many may maybe me might mine more most much must my myself near neither never no nobody
none nor not nothing now of off often on once one only onto or other others otherwise our ours
ourselves out outside over own per perhaps quite rather really same shall she should since so
some somebody someone something sometimes somewhere soon still such than that the their theirs
them themselves then there these they this those though through thus till to too toward towards
under unless until up upon us very via was we were what whatever when whenever where wherever
whether which while who whoever whole whom whose why will with within without would yet you
your yours yourself yourselves

what's whats it's that's there's here's who's let's lets isn't aren't wasn't weren't don't
doesn't didn't won't can't couldn't shouldn't wouldn't haven't hasn't hadn't i'm i've we're
we've they're you're

ask asked asking bring brought call called came check checked come comes coming compare compared
comparing count counted counting drop dropped dropping drops explain explained fall fallen falls
fell find found get gets getting give given gives go goes going gone got grow grew growing grown
grows happen happened happening happens has help hold keep kept know known knows lag lagged let
look looked looking looks lose lost made make makes making mean meant means move moved need
needed needs put rise risen rises rose run said say says see seen seem seems show showed shown
shows split start started starts stay stayed stop stopped stops take taken takes tell think
thought try tried turn turned use used want wanted went work worked write written wrote jump
jumped spike spiked change changed changes trend trending trends land landed sit sat perform
performed performing doing did fare fared track tracked tracking hit dip dipped climb climbed
slip slipped slow slowed faring holding behaving lagging slipping shaping selling ticking settling moving pick picked report reported

able actual actually additional all-time average bad best better big bigger biggest brief broad
certain clear close common complete current daily different early earlier easy entire exact
exactly extra fast final fine first flat full general good great gross half hard high higher
highest huge important large larger largest last late later latest likely little local long low
lower lowest main major minor monthly near net new newer newest next normal old older open
overall paid particular past plain possible previous prior private public quarterly quick real
recent regular relative absolute right rough second short similar simple single slow small
smaller smallest special specific standard strong sure third top total true typical unusual
usual various weak weekly whole wide worse worst wrong yearly year-to-date online offline
direct indirect organic returning existing repeat loyal active inactive paying free cheap
expensive premium basic domestic foreign international global national regional own key
top-line bottom-line underlying adjusted reported expected planned forecast forecasted budget
budgeted target actuals

again ago already almost back currently ever lately recently still today tonight tomorrow
yesterday now then soon often usually always never sometimes once twice anymore elsewhere
overall together apart especially generally mostly mainly partly roughly nearly about around
approx approximately

amount amounts answer answers area areas basis board breakdown budget bulk business case cases
cash cause caused causes change chart company comparison context cost costs count data deal deals
detail details difference drivers effect effects end example fact figure figures future
general growth idea impact information issue issues item items kind kinds level levels line
lines list matter mind mix money note notes number numbers order part parts past percentage
picture place point points practice price prices principle problem problems progress question
questions rate rates reason reasons reference regard regards respect result results risk role
scale share short side size sort sorts source sources stage state status stock sum summary
term terms theory thing things time times total totals turn type types update value values view
way ways whole word words work world advance addition contrast common progress regulator
regulators report reports people person customer customers team teams campaigns markets
countries brands stores channels regions products segments categories platforms discount
discounts margin margins delivery deliveries shipping payment payments provider providers trust
plan plans goal goals forecast target targets spend revenue sales sale traffic volume volumes
performance result outcome outcomes overview split splits share shares launch launches release
releases promo promos promotion promotions offer offers event events incident incidents outage
outages week's month's year's day's quarter's comparison comparisons benchmark benchmarks
baseline average averages median medians mean peak peaks low lows high highs record records
subscription subscriptions gift gifts card cards credit debit invoice invoices refund refunds
voucher vouchers coupon coupons pending duplicate duplicates guest guests recurring missing fake
test tests trial trials draft drafts
moment moments checkout review reviews pickup pick-up abroad finance owns own owned owner owners
drive drives driving drove read reads reading recover recovering bounce bouncing clear clearing
ship ships shipped stand standing hold
thanks thank please ok okay hi hello hey sorry yes yeah yep nope

second seconds minute minutes hour hours day days week weeks weekend weekends month months
quarter quarters year years decade season seasons spring summer autumn fall winter mid early late
end start beginning middle period periods date dates time morning afternoon evening night
fortnight daytime holiday holidays

zero one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty
hundred hundreds thousand thousands million millions billion billions dozen half quarter percent
cent per-cent pct

euro euros eur usd dollar dollars gbp pound pounds sterling chf franc francs nok sek dkk krone
kroner krona kronor jpy yen cny yuan cad aud pln zloty inr rupee rupees currency currencies
ytd mtd qtd yoy mom wow ttm

english norwegian swedish danish finnish german french spanish italian dutch polish portuguese
language languages translation
`

/** Everyday words, lowercase. */
export const everydayWords: ReadonlySet<string> = /* @__PURE__ */ (() =>
  new Set(words.split(/\s+/).filter(Boolean)))()

/** Whether a word, lowercase as normalizeName gives it, is in the list of everyday words. */
export const isEverydayWord = (word: string) => everydayWords.has(word.replace(/'s$/, ''))

/**
 * Whether a word that is not written in Title case says how something went ("growing", "dropped",
 * "weekly"), by its ending. A person who means a value so named writes it in Title case
 * ("Hiking"). Only where a name is not what is being looked for; where a value goes, only the
 * list applies.
 */
export const saysHow = (word: string, titleCase: boolean, ending = /(ing|ed|ly)$/) =>
  !titleCase && ending.test(word)
