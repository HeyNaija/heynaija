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
  // Shown only to members with Games (docs/adr/0018); see `settingsFor`.
  { kind: 'chess_challenge', label: 'Someone challenges you to chess' },
] as const

/** Kinds that belong to a feature behind a flag: the box shows only where the flag is on. */
const BEHIND_GAMES: readonly OptionalNotificationKind[] = ['chess_challenge']

/**
 * The boxes to show a member, and the kinds left out. A kind left out keeps what
 * it was, through a hidden field, so saving the form never changes it unseen.
 */
export function settingsFor(features: { games?: boolean }) {
  const shown = NOTIFICATION_SETTINGS.filter(({ kind }) => features.games || !BEHIND_GAMES.includes(kind))
  const hidden = NOTIFICATION_SETTINGS.filter((s) => !shown.includes(s)).map(({ kind }) => kind)
  return { shown, hidden }
}

export type OptionalNotificationKind = (typeof NOTIFICATION_SETTINGS)[number]['kind']

/**
 * For each kind a member can turn off, whether it is on, and whether the
 * notifications they get are also sent to them by email.
 */
export type NotificationPreferences = Record<OptionalNotificationKind, boolean> & { email: boolean }

/**
 * The whole set of choices from the Settings form: a ticked box is a kind left
 * on, and the email box says whether notifications are emailed.
 */
export function preferencesFromForm(formData: FormData): NotificationPreferences {
  const on = new Set(formData.getAll('on').map(String))
  const kinds = Object.fromEntries(NOTIFICATION_SETTINGS.map(({ kind }) => [kind, on.has(kind)])) as Record<
    OptionalNotificationKind,
    boolean
  >
  return { email: formData.has('email'), ...kinds }
}
