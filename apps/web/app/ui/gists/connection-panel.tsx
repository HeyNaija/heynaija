'use client'

import { useEffect, useState } from 'react'
import { measurementLine, msText, percentText, routeNote, routeText, summarize, verdictText, type Sample, type Summary } from '@/lib/gist-connection'

/** How often the sheet reads the connection while it is open. */
const EVERY_MS = 2000

/**
 * How the member's connection is doing, read every two seconds while the sheet is
 * open (the sheet renders nothing while closed, so nothing runs then). The figures
 * are the ones the Lagos measurement records, and "Copy figures" gives them as one
 * line to paste (docs/deployment/livekit.md).
 */
export function ConnectionPanel({ read, speaker }: { read: () => Promise<Sample | null>; speaker: boolean }) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [empty, setEmpty] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let prev: Sample | null = null
    let stopped = false
    const tick = async () => {
      const now = await read().catch(() => null)
      if (stopped) return
      setEmpty(now === null)
      if (!now) return
      setSummary(summarize(prev, now))
      prev = now
    }
    void tick()
    const timer = setInterval(tick, EVERY_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [read])

  async function copy() {
    if (!summary) return
    const network = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType
    try {
      await navigator.clipboard.writeText(measurementLine(summary, network))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="gist-mic-panel">
      {empty && !summary ? (
        <p className="text-sm">Nothing to measure yet. The figures appear once someone on stage turns their microphone on.</p>
      ) : (
        <p className="text-sm">{verdictText(summary?.verdict ?? 'unknown', speaker)}</p>
      )}
      <dl className="gist-figures">
        <dt>Route</dt>
        <dd>{routeText[summary?.route ?? 'unknown']}</dd>
        <dt>Round trip to the server</dt>
        <dd>{msText(summary?.rttMs ?? null)}</dd>
        <dt>Sound lost on the way</dt>
        <dd>{percentText(summary?.lossPercent ?? null)}</dd>
        <dt>Jitter (uneven arrival)</dt>
        <dd>{msText(summary?.jitterMs ?? null)}</dd>
        <dt>Sound filled in by your device</dt>
        <dd>{percentText(summary?.concealedPercent ?? null)}</dd>
      </dl>
      {summary && routeNote(summary.route) ? <p className="field-hint">{routeNote(summary.route)}</p> : null}
      <p className="field-hint">
        What helps: earphones, so the Gist does not echo back through a microphone; standing nearer your Wi-Fi; or switching between Wi-Fi and mobile data.
      </p>
      <div className="gist-actions mt-2">
        <button type="button" className="btn btn-secondary gist-btn" disabled={!summary} onClick={copy}>
          Copy figures
        </button>
        <span role="status" className="gist-note">
          {copied ? 'Copied.' : ''}
        </span>
      </div>
    </div>
  )
}
