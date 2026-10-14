import { setMembership } from '@/app/actions'
import { SubmitButton } from './submit-button'

export function JoinButton({ slug, joined, compact = false }: { slug: string; joined: boolean; compact?: boolean }) {
  return (
    <form action={setMembership} className="shrink-0">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="on" value={joined ? '0' : '1'} />
      <SubmitButton
        pressed={joined}
        className={`btn ${compact ? 'btn-sm' : ''} ${joined ? 'btn-ghost border-line' : 'btn-secondary'}`}
      >
        {joined ? 'Joined' : 'Join'}
      </SubmitButton>
    </form>
  )
}
