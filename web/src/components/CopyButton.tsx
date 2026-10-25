import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { Button } from './ui/button'

export function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text)
  // Plain-HTTP LAN origins have no async clipboard API.
  const el = document.createElement('textarea')
  el.value = text
  el.style.position = 'fixed'
  el.style.opacity = '0'
  document.body.appendChild(el)
  el.select()
  document.execCommand('copy')
  el.remove()
  return Promise.resolve()
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      size={label ? 'sm' : 'icon-sm'}
      variant="ghost"
      onClick={() => copyText(text).then(() => {
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      })}
      title="Copy"
    >
      {done ? <Check strokeWidth={1.5} /> : <Copy strokeWidth={1.5} />}
      {label}
    </Button>
  )
}
