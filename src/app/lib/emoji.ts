// The emoji people can type with ':' and two letters, in comments and notes: about 150 common
// ones, curated by hand, in four groups, each with its name (what a screen reader says) and the
// shortcode Slack and GitHub use. No giant dataset and no skin tones: the plain emoji only. What is
// inserted is the character itself, plain text. Context and definitions take no picker: agents read
// that text, so an emoji pasted there gets a quiet note instead.

export type EmojiGroup = 'Smileys' | 'Gestures' | 'Objects' | 'Symbols'
export type Emoji = {
  char: string
  name: string
  short: string
  group: EmojiGroup
  also?: string[]
}

const e = (
  group: EmojiGroup,
  char: string,
  name: string,
  short: string,
  also?: string[],
): Emoji => ({ char, name, short, group, also })

export const EMOJI: Emoji[] = [
  // Smileys
  e('Smileys', '😀', 'grinning face', 'grinning', ['happy']),
  e('Smileys', '😃', 'grinning face with big eyes', 'smiley', ['happy']),
  e('Smileys', '😄', 'grinning face with smiling eyes', 'smile', ['happy']),
  e('Smileys', '😁', 'beaming face with smiling eyes', 'grin'),
  e('Smileys', '😆', 'grinning squinting face', 'laughing', ['satisfied']),
  e('Smileys', '😅', 'grinning face with sweat', 'sweat_smile', ['phew']),
  e('Smileys', '🤣', 'rolling on the floor laughing', 'rofl'),
  e('Smileys', '😂', 'face with tears of joy', 'joy', ['lol']),
  e('Smileys', '🙂', 'slightly smiling face', 'slightly_smiling_face'),
  e('Smileys', '🙃', 'upside-down face', 'upside_down_face'),
  e('Smileys', '😉', 'winking face', 'wink'),
  e('Smileys', '😊', 'smiling face with smiling eyes', 'blush'),
  e('Smileys', '😇', 'smiling face with halo', 'innocent'),
  e('Smileys', '🥰', 'smiling face with hearts', 'smiling_face_with_hearts'),
  e('Smileys', '😍', 'smiling face with heart-eyes', 'heart_eyes'),
  e('Smileys', '🤩', 'star-struck', 'star_struck'),
  e('Smileys', '😘', 'face blowing a kiss', 'kissing_heart'),
  e('Smileys', '😋', 'face savoring food', 'yum'),
  e('Smileys', '😛', 'face with tongue', 'stuck_out_tongue'),
  e('Smileys', '😜', 'winking face with tongue', 'stuck_out_tongue_winking_eye'),
  e('Smileys', '🤗', 'smiling face with open hands', 'hugs', ['hug']),
  e('Smileys', '🤔', 'thinking face', 'thinking'),
  e('Smileys', '🤨', 'face with raised eyebrow', 'raised_eyebrow'),
  e('Smileys', '😐', 'neutral face', 'neutral_face'),
  e('Smileys', '😏', 'smirking face', 'smirk'),
  e('Smileys', '😒', 'unamused face', 'unamused'),
  e('Smileys', '🙄', 'face with rolling eyes', 'roll_eyes'),
  e('Smileys', '😬', 'grimacing face', 'grimacing'),
  e('Smileys', '😌', 'relieved face', 'relieved'),
  e('Smileys', '😔', 'pensive face', 'pensive'),
  e('Smileys', '😴', 'sleeping face', 'sleeping'),
  e('Smileys', '😷', 'face with medical mask', 'mask'),
  e('Smileys', '🤯', 'exploding head', 'exploding_head', ['mind_blown']),
  e('Smileys', '🥳', 'partying face', 'partying_face', ['party']),
  e('Smileys', '😎', 'smiling face with sunglasses', 'sunglasses', ['cool']),
  e('Smileys', '🤓', 'nerd face', 'nerd_face'),
  e('Smileys', '😕', 'confused face', 'confused'),
  e('Smileys', '😟', 'worried face', 'worried'),
  e('Smileys', '🙁', 'slightly frowning face', 'slightly_frowning_face'),
  e('Smileys', '😮', 'face with open mouth', 'open_mouth', ['wow']),
  e('Smileys', '😲', 'astonished face', 'astonished'),
  e('Smileys', '😳', 'flushed face', 'flushed'),
  e('Smileys', '🥺', 'pleading face', 'pleading_face'),
  e('Smileys', '😢', 'crying face', 'cry', ['sad']),
  e('Smileys', '😭', 'loudly crying face', 'sob'),
  e('Smileys', '😱', 'face screaming in fear', 'scream'),
  e('Smileys', '😠', 'angry face', 'angry'),
  e('Smileys', '🤦', 'person facepalming', 'facepalm'),
  e('Smileys', '🤷', 'person shrugging', 'shrug'),
  // Gestures
  e('Gestures', '👍', 'thumbs up', 'thumbsup', ['+1', 'yes']),
  e('Gestures', '👎', 'thumbs down', 'thumbsdown', ['-1', 'no']),
  e('Gestures', '👀', 'eyes', 'eyes', ['looking']),
  e('Gestures', '🙏', 'folded hands', 'pray', ['thanks', 'please']),
  e('Gestures', '👏', 'clapping hands', 'clap'),
  e('Gestures', '🙌', 'raising hands', 'raised_hands', ['hooray']),
  e('Gestures', '👋', 'waving hand', 'wave', ['hello', 'bye']),
  e('Gestures', '👌', 'OK hand', 'ok_hand'),
  e('Gestures', '✌️', 'victory hand', 'v', ['peace']),
  e('Gestures', '🤞', 'crossed fingers', 'crossed_fingers', ['luck']),
  e('Gestures', '🤝', 'handshake', 'handshake', ['deal']),
  e('Gestures', '💪', 'flexed biceps', 'muscle', ['strong']),
  e('Gestures', '👉', 'backhand index pointing right', 'point_right'),
  e('Gestures', '👈', 'backhand index pointing left', 'point_left'),
  e('Gestures', '👆', 'backhand index pointing up', 'point_up_2'),
  e('Gestures', '👇', 'backhand index pointing down', 'point_down'),
  e('Gestures', '☝️', 'index pointing up', 'point_up'),
  e('Gestures', '✋', 'raised hand', 'raised_hand', ['hand']),
  e('Gestures', '🤙', 'call me hand', 'call_me_hand'),
  e('Gestures', '👊', 'oncoming fist', 'fist_oncoming', ['punch']),
  e('Gestures', '🫡', 'saluting face', 'saluting_face', ['salute']),
  e('Gestures', '🫶', 'heart hands', 'heart_hands'),
  e('Gestures', '✍️', 'writing hand', 'writing_hand'),
  e('Gestures', '🧠', 'brain', 'brain'),
  e('Gestures', '🙋', 'person raising hand', 'raising_hand'),
  e('Gestures', '🙇', 'person bowing', 'bow'),
  // Objects
  e('Objects', '🎉', 'party popper', 'tada', ['party', 'celebrate']),
  e('Objects', '🎁', 'wrapped gift', 'gift'),
  e('Objects', '🏆', 'trophy', 'trophy'),
  e('Objects', '🚀', 'rocket', 'rocket', ['ship', 'launch']),
  e('Objects', '🔥', 'fire', 'fire', ['hot', 'lit']),
  e('Objects', '✨', 'sparkles', 'sparkles', ['new']),
  e('Objects', '⭐', 'star', 'star'),
  e('Objects', '⚡', 'high voltage', 'zap', ['fast']),
  e('Objects', '💡', 'light bulb', 'bulb', ['idea']),
  e('Objects', '📌', 'pushpin', 'pushpin', ['pin']),
  e('Objects', '📎', 'paperclip', 'paperclip'),
  e('Objects', '📝', 'memo', 'memo', ['note', 'pencil']),
  e('Objects', '✏️', 'pencil', 'pencil2'),
  e('Objects', '📅', 'calendar', 'date', ['calendar']),
  e('Objects', '⏰', 'alarm clock', 'alarm_clock'),
  e('Objects', '⏳', 'hourglass not done', 'hourglass_flowing_sand', ['wait']),
  e('Objects', '📈', 'chart increasing', 'chart_with_upwards_trend', ['up', 'growth']),
  e('Objects', '📉', 'chart decreasing', 'chart_with_downwards_trend', ['down', 'drop']),
  e('Objects', '📊', 'bar chart', 'bar_chart'),
  e('Objects', '📋', 'clipboard', 'clipboard'),
  e('Objects', '📁', 'file folder', 'file_folder', ['folder']),
  e('Objects', '📄', 'page facing up', 'page_facing_up', ['doc']),
  e('Objects', '🔗', 'link', 'link'),
  e('Objects', '🔍', 'magnifying glass tilted left', 'mag', ['search']),
  e('Objects', '🔒', 'locked', 'lock'),
  e('Objects', '🔑', 'key', 'key'),
  e('Objects', '🛠️', 'hammer and wrench', 'hammer_and_wrench', ['tools']),
  e('Objects', '🔧', 'wrench', 'wrench'),
  e('Objects', '🧪', 'test tube', 'test_tube', ['test']),
  e('Objects', '📦', 'package', 'package', ['box']),
  e('Objects', '🛒', 'shopping cart', 'shopping_cart', ['cart']),
  e('Objects', '💰', 'money bag', 'moneybag'),
  e('Objects', '💶', 'euro banknote', 'euro'),
  e('Objects', '💳', 'credit card', 'credit_card', ['card', 'payment']),
  e('Objects', '🧾', 'receipt', 'receipt'),
  e('Objects', '📣', 'megaphone', 'mega', ['announce']),
  e('Objects', '🔔', 'bell', 'bell', ['notify']),
  e('Objects', '💬', 'speech balloon', 'speech_balloon', ['comment']),
  e('Objects', '📧', 'e-mail', 'email'),
  e('Objects', '☕', 'hot beverage', 'coffee'),
  e('Objects', '🌍', 'globe showing Europe-Africa', 'earth_africa', ['world']),
  e('Objects', '☀️', 'sun', 'sunny'),
  e('Objects', '🌧️', 'cloud with rain', 'cloud_with_rain', ['rain']),
  e('Objects', '❄️', 'snowflake', 'snowflake', ['cold']),
  e('Objects', '🏁', 'chequered flag', 'checkered_flag', ['finish']),
  e('Objects', '🚩', 'triangular flag', 'triangular_flag_on_post', ['flag']),
  e('Objects', '🎯', 'bullseye', 'dart', ['target']),
  e('Objects', '🧭', 'compass', 'compass'),
  e('Objects', '🐛', 'bug', 'bug'),
  // Symbols
  e('Symbols', '✅', 'check mark button', 'white_check_mark', ['done', 'check', 'yes']),
  e('Symbols', '✔️', 'check mark', 'heavy_check_mark'),
  e('Symbols', '❌', 'cross mark', 'x', ['no', 'wrong']),
  e('Symbols', '❗', 'red exclamation mark', 'exclamation', ['important']),
  e('Symbols', '❓', 'red question mark', 'question'),
  e('Symbols', '⚠️', 'warning', 'warning', ['caution']),
  e('Symbols', '🚫', 'prohibited', 'no_entry_sign', ['blocked']),
  e('Symbols', '⛔', 'no entry', 'no_entry'),
  e('Symbols', '💯', 'hundred points', '100', ['perfect']),
  e('Symbols', '❤️', 'red heart', 'heart', ['love']),
  e('Symbols', '💙', 'blue heart', 'blue_heart'),
  e('Symbols', '💚', 'green heart', 'green_heart'),
  e('Symbols', '➕', 'plus', 'heavy_plus_sign', ['add']),
  e('Symbols', '➡️', 'right arrow', 'arrow_right', ['next']),
  e('Symbols', '⬅️', 'left arrow', 'arrow_left', ['back']),
  e('Symbols', '⬆️', 'up arrow', 'arrow_up'),
  e('Symbols', '⬇️', 'down arrow', 'arrow_down'),
  e('Symbols', '🔁', 'repeat button', 'repeat', ['again']),
  e('Symbols', '🔄', 'counterclockwise arrows button', 'arrows_counterclockwise', [
    'sync',
    'refresh',
  ]),
  e('Symbols', '🆕', 'NEW button', 'new'),
  e('Symbols', '🆗', 'OK button', 'ok'),
  e('Symbols', '🔴', 'red circle', 'red_circle'),
  e('Symbols', '🟢', 'green circle', 'green_circle'),
  e('Symbols', '🟡', 'yellow circle', 'yellow_circle'),
  e('Symbols', '💤', 'zzz', 'zzz', ['sleep']),
  e('Symbols', '♻️', 'recycling symbol', 'recycle'),
]

export const GROUPS: EmojiGroup[] = ['Smileys', 'Gestures', 'Objects', 'Symbols']

/** The five fixed reactions on a comment: they come first in the picker too. */
export const REACTION_CHARS = ['👍', '👀', '✅', '🤔', '🙏']

const byShort = new Map(
  EMOJI.flatMap((x) => [[x.short, x] as const, ...(x.also ?? []).map((a) => [a, x] as const)]),
)

/** ':tada:' typed out in full: the emoji it names, if it names one. */
export const fromShortcode = (code: string) => byShort.get(code.toLowerCase())

/** Whether text holds an emoji, for the quiet note in text agents read. */
export const hasEmoji = (text: string) => /\p{Extended_Pictographic}/u.test(text)

/* ---------- what was used lately, kept on this device ---------- */

const KEY = 'heed.emoji.recent'
let recent: string[] = (() => {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]') as string[]
  } catch {
    return []
  }
})()

export const recentEmoji = () => recent

export function rememberEmoji(char: string) {
  recent = [char, ...recent.filter((c) => c !== char)].slice(0, 8)
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(recent))
  } catch {
    // Private windows can refuse storage: the list just isn't remembered.
  }
}

/* ---------- search ---------- */

const words = (x: Emoji) => [x.short, ...(x.also ?? []), ...x.name.split(/[\s-]+/)]

/** How well a query fits: a shortcode that starts with it first, then a word that does, then anywhere. */
function score(x: Emoji, q: string) {
  if (x.short.startsWith(q)) return 3
  if (words(x).some((w) => w.toLowerCase().startsWith(q))) return 2
  if (x.short.includes(q) || x.name.includes(q)) return 1
  return 0
}

/**
 * The emoji a query finds, grouped: what was used lately and the five reactions first ("Frequently
 * used"), then the groups, the group with the best fit first and the best fits first in each. A
 * name that only contains the letters counts when nothing starts with them.
 */
export function searchEmoji(
  query: string,
  used: string[] = recent,
): { label: string; items: Emoji[] }[] {
  const q = query.toLowerCase().replace(/^:/, '')
  const scored = EMOJI.map((x) => ({ x, s: score(x, q) })).filter((h) => h.s > 0)
  const best = Math.max(0, ...scored.map((h) => h.s))
  const hits = scored.filter((h) => best < 2 || h.s >= 2).sort((a, b) => b.s - a.s)
  const first = [...used, ...REACTION_CHARS]
  const often = first.map((c) => hits.find((h) => h.x.char === c)?.x).filter((x): x is Emoji => !!x)
  const rest = hits.filter((h) => !often.includes(h.x))
  const top = (g: EmojiGroup) => Math.max(0, ...rest.filter((h) => h.x.group === g).map((h) => h.s))
  const groups = [...GROUPS].sort((a, b) => top(b) - top(a))
  return [
    { label: 'Frequently used', items: often },
    ...groups.map((g) => ({
      label: g,
      items: rest.filter((h) => h.x.group === g).map((h) => h.x),
    })),
  ].filter((g) => g.items.length)
}
