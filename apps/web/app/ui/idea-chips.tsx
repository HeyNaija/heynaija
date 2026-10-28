import type { IdeaKind, IdeaStatus } from '@/lib/api'
import { KIND_LABELS, STATUS_LABELS } from '@/lib/ideas'

/** An idea's status, as a chip: open ones in green once a moderator has taken them up. */
export function IdeaStatusChip({ status }: { status: IdeaStatus }) {
  return <span className={`status-chip idea-status is-${status.replace('_', '-')}`}>{STATUS_LABELS[status]}</span>
}

export function IdeaKindChip({ kind }: { kind: IdeaKind }) {
  return <span className={`status-chip idea-kind is-${kind}`}>{KIND_LABELS[kind]}</span>
}
