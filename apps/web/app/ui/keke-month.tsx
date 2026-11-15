import Link from 'next/link'
import type { KekeMonth, KekeOutcome } from '@/lib/api'

const COLUMNS: { key: KekeOutcome; label: string }[] = [
  { key: 'answered', label: 'Answered' },
  { key: 'not_covered', label: 'Not covered' },
  { key: 'off_topic', label: 'Off topic' },
  { key: 'unsourced', label: 'No page named' },
  { key: 'failed', label: 'Failed' },
  { key: 'refused', label: 'Declined' },
]

const dollars = (usd: number) => `$${usd.toFixed(usd > 0 && usd < 1 ? 3 : 2)}`

/**
 * Keke's month on /mod (ADR 0030), for site moderators: each model's calls by
 * how they went and what they cost, to compare Claude Haiku 5.5 and DeepSeek on
 * real questions, and the month's spending against the cap.
 */
export function KekeMonthPanel({ month }: { month: KekeMonth }) {
  const monthName = new Date(`${month.month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return (
    <>
      <p className="mt-1 text-sm text-muted">
        {dollars(month.spentUsd)} of the {dollars(month.budgetUsd)} cap spent in {monthName}. Each row counts calls to one
        model: a question one model could not answer and the other did counts once for each.{' '}
        <Link href="/about/keke" className="font-semibold text-accent-strong hover:underline">How Keke works</Link>
      </p>
      {month.stopped ? (
        <p role="status" className="notice mt-3">
          Keke has reached this month&rsquo;s cap and is not answering until next month. Raise KEKE_MONTHLY_BUDGET_USD on the
          server to let it go on.
        </p>
      ) : null}
      {month.models.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No questions yet this month.</p>
      ) : (
        <div className="mod-table-wrap">
          <table className="mod-table">
            <caption className="sr-only">Keke&rsquo;s calls this month, by model and outcome</caption>
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Calls</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} scope="col">{c.label}</th>
                ))}
                <th scope="col">Cost</th>
              </tr>
            </thead>
            <tbody>
              {month.models.map((m) => (
                <tr key={`${m.model} ${m.via}`}>
                  <th scope="row">
                    {m.name}
                    <span className="block text-xs font-normal text-muted">
                      {m.model}, via {m.via === 'anthropic' ? 'Anthropic' : 'OpenRouter'}
                    </span>
                  </th>
                  <td>{m.calls}</td>
                  {COLUMNS.map((c) => (
                    <td key={c.key}>{m.outcomes[c.key] ?? 0}</td>
                  ))}
                  <td>{dollars(m.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
