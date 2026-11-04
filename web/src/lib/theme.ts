import { useEffect, useState } from 'react'

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    const background = getComputedStyle(document.documentElement).getPropertyValue('--background').trim()
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', background)
    try {
      localStorage.setItem('proxmiu-theme', dark ? 'dark' : 'light')
    } catch {
      /* storage unavailable */
    }
  }, [dark])
  return { dark, toggle: () => setDark((d) => !d) }
}
