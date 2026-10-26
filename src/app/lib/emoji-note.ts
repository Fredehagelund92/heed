import { toast } from 'sonner'
import { hasEmoji } from '@/lib/emoji'

// Text agents read (context, definitions, titles) takes no emoji list. When someone pastes an emoji
// into it anyway, one quiet note says agents read it too; the paste goes ahead.

export const EMOJI_NOTE = 'Emoji in context are read by agents too'

export function noteEmoji(text: string) {
  if (hasEmoji(text)) toast(EMOJI_NOTE, { id: 'emoji-note', duration: 4000 })
}
