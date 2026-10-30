// Deleting your own account (docs/adr/0016): what the API's answers mean for the
// pages, and how the date reaches a member who has just been signed out.

/** Where a member lands once they have asked, signed out (app/(main)/settings/delete/scheduled). */
export const DELETION_SCHEDULED_PATH = '/settings/delete/scheduled'

/** Back to the form after signing in again, which then says so. */
export const DELETION_REAUTHED_PATH = '/settings/delete?signed_in=1'

/**
 * Carries the erase date to DELETION_SCHEDULED_PATH: by then the session has
 * ended, so the page cannot ask the API.
 */
export const DELETION_COOKIE = 'hn_deletion'

export type DeletionAnswer =
  | { kind: 'scheduled'; scheduledFor: string }
  | { kind: 'reauth' }
  | { kind: 'signed_out' }
  | { kind: 'error'; message: string }

/** What the API's answer to `POST /v1/me/deletion` means for the form. */
export function deletionAnswer(status: number, body: { code?: string; scheduledFor?: string }): DeletionAnswer {
  if (status === 200 && body.scheduledFor) return { kind: 'scheduled', scheduledFor: body.scheduledFor }
  if (status === 401) return { kind: 'signed_out' }
  if (status === 403 && body.code === 'reauth_required') return { kind: 'reauth' }
  if (status === 403 && body.code === 'site_moderator') {
    return { kind: 'error', message: 'A site moderator cannot delete their own account. Ask to stop being a moderator first.' }
  }
  if (status === 400) {
    return { kind: 'error', message: 'That is not your handle. Type it as it appears after the @ on your profile.' }
  }
  if (status === 429) return { kind: 'error', message: 'You have tried several times this hour. Wait an hour and try again.' }
  return { kind: 'error', message: 'Your account could not be deleted just now. Try again in a few minutes.' }
}

/** What the API's answer to `DELETE /v1/me/deletion` means: null when it is cancelled. */
export function cancelAnswer(status: number, body: { code?: string }): { kind: 'signed_out' } | { kind: 'error'; message: string } | null {
  if (status === 204) return null
  if (status === 401) return { kind: 'signed_out' }
  if (status === 409 && body.code === 'too_late') {
    return { kind: 'error', message: 'It is too late to cancel: your account is being deleted now.' }
  }
  if (status === 429) return { kind: 'error', message: 'You have tried several times this hour. Wait an hour and try again.' }
  return { kind: 'error', message: 'The deletion could not be cancelled just now. Try again in a few minutes.' }
}

/** The date in DELETION_COOKIE, if it holds one. */
export function scheduledDate(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)) return null
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}
