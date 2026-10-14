'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { THEME_KEY, type ThemeChoice } from '@/lib/theme'

const OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

function read(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

// The inline script in <head> owns applying the theme (and following the device).
const apply = () => (window as unknown as { __hnTheme?: () => void }).__hnTheme?.()

// The choice lives in localStorage; this keeps every switch on the page, and other
// tabs, showing the same thing.
function subscribe(onChange: () => void) {
  const sync = () => {
    apply()
    onChange()
  }
  window.addEventListener('storage', sync)
  window.addEventListener('hn-theme', onChange)
  return () => {
    window.removeEventListener('storage', sync)
    window.removeEventListener('hn-theme', onChange)
  }
}

export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  // On the server (and for the first client render) nothing is marked as chosen,
  // so the markup matches; the real choice appears as soon as React attaches.
  const choice = useSyncExternalStore<ThemeChoice | null>(subscribe, read, () => null)

  const choose = (value: ThemeChoice) => {
    try {
      localStorage.setItem(THEME_KEY, value)
    } catch {
      // Private browsing: the choice still applies for this page.
    }
    apply()
    window.dispatchEvent(new Event('hn-theme'))
  }

  return (
    <div role="group" aria-label="Theme" className="segmented">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={choice === value}
          aria-label={compact ? label : undefined}
          title={compact ? label : undefined}
          onClick={() => choose(value)}
        >
          <Icon aria-hidden="true" size={16} strokeWidth={1.9} />
          {compact ? null : label}
        </button>
      ))}
    </div>
  )
}
