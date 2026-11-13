/**
 * The kinds of notification a member can turn off in Settings: other members'
 * activity. The API refuses any other kind, because safety and moderation
 * notices are always sent.
 */
export const NOTIFICATION_SETTINGS = [
  { kind: 'reply', label: 'Someone replies to your post' },
  { kind: 'mention', label: 'Someone mentions you' },
  { kind: 'like', label: 'Someone likes your post' },
  { kind: 'repost', label: 'Someone reposts your post' },
  { kind: 'quote', label: 'Someone quotes your post' },
  { kind: 'follow', label: 'Someone follows you' },
  { kind: 'story_update', label: 'Someone adds to a story you follow' },
] as const

export type OptionalNotificationKind = (typeof NOTIFICATION_SETTINGS)[number]['kind']

/**
 * For each kind a member can turn off, whether it is on, and whether the
 * notifications they get are also sent to them by email.
 */
export type NotificationPreferences = Record<OptionalNotificationKind, boolean> & {
  email: boolean
  /**
   * Whether weekly highlights are sent (docs/adr/0027). Absent while they are not
   * offered to this member, and the form then has no box for them.
   */
  highlights?: boolean
}

/**
 * The whole set of choices from the Settings form: a ticked box is a kind left
 * on, the email box says whether notifications are emailed, and the highlights
 * box, where the form has one, whether weekly highlights are sent.
 */
export function preferencesFromForm(formData: FormData): NotificationPreferences {
  const on = new Set(formData.getAll('on').map(String))
  const kinds = Object.fromEntries(NOTIFICATION_SETTINGS.map(({ kind }) => [kind, on.has(kind)])) as Record<
    OptionalNotificationKind,
    boolean
  >
  // The highlights box is on the form only while highlights are offered, which the
  // form says with `highlights-offered`. A form without it leaves that choice as it is.
  const highlights = formData.has('highlights-offered') ? { highlights: formData.has('highlights') } : {}
  return { email: formData.has('email'), ...highlights, ...kinds }
}
