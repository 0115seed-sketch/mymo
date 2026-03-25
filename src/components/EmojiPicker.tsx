import { createSignal, For } from 'solid-js'
import type { Component } from 'solid-js'

const EMOJI_CATEGORIES: { name: string; emojis: string[] }[] = [
  {
    name: '자주 쓰는',
    emojis: ['😀', '😊', '😂', '🥰', '😎', '🤔', '👍', '👎', '❤️', '🔥', '⭐', '✅', '❌', '⚡', '💡', '📌', '🎯', '🚀', '💪', '🙏', '👏', '🎉', '💀', '😱'],
  },
  {
    name: '표정',
    emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮'],
  },
  {
    name: '손/사람',
    emojis: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '💪'],
  },
  {
    name: '사물/기호',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '💕', '💖', '💗', '💘', '💝', '⭐', '🌟', '✨', '⚡', '🔥', '💥', '❄️', '🌈', '☀️', '🌙', '💡', '📌', '📎', '✏️', '📝', '📁', '📂', '🗑️', '🔒', '🔑', '🔔', '📅', '⏰', '✅', '❌', '⚠️', '🚫', '💯', '🎯', '🚀', '🏆', '🎉', '🎊'],
  },
]

interface EmojiPickerProps {
  onSelect: (emoji: string) => void
  onClose: () => void
}

const EmojiPicker: Component<EmojiPickerProps> = (props) => {
  const [category, setCategory] = createSignal(0)

  return (
    <div class="emoji-picker">
      <div class="emoji-tabs">
        <For each={EMOJI_CATEGORIES}>
          {(cat, i) => (
            <button
              class={`emoji-tab ${category() === i() ? 'emoji-tab-active' : ''}`}
              onClick={() => setCategory(i())}
            >
              {cat.name}
            </button>
          )}
        </For>
      </div>
      <div class="emoji-grid">
        <For each={EMOJI_CATEGORIES[category()].emojis}>
          {(emoji) => (
            <button
              class="emoji-item"
              onClick={() => {
                props.onSelect(emoji)
                props.onClose()
              }}
            >
              {emoji}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

export default EmojiPicker
