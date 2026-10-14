import { useState } from 'react'

/** Texto editável dentro de tabelas: parece célula, grava ao sair do campo (vazio = null) */
export function InlineTextInput({ value, onCommit, label, disabled }: { value: string | null; onCommit: (v: string | null) => void; label: string; disabled?: boolean }) {
  const [text, setText] = useState(value ?? '')
  return (
    <input
      aria-label={label}
      value={text}
      disabled={disabled}
      placeholder="—"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const v = text.trim() || null
        if (v !== (value ?? null)) onCommit(v)
      }}
      className="h-8 w-full rounded-control border border-transparent bg-transparent px-2 text-sm placeholder:text-ink-300 hover:border-border focus:border-primary focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:hover:border-transparent"
    />
  )
}
