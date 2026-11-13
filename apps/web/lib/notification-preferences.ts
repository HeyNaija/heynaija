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
  // Shown only while community announcements are switched on (docs/adr/0029); see `settingsFor`.
  { kind: 'community_announcement', label: 'Someone sends an announcement to a community you joined' },
  // Shown only to members with Games (docs/adr/0028); see `settingsFor`. One box for both chess kinds (BOX_ALSO).
  { kind: 'chess_challenge', label: 'Someone challenges you to chess, or your game starts' },
] as const

/** Kinds that have no box of their own and follow another box. */
const BOX_ALSO = { chess_challenge: ['chess_game_started'] } as const

/** Every kind a member can turn off: one per box, and those that follow a box. */
export const OPTIONAL_KINDS = [...NOTIFICATION_SETTINGS.map(({ kind }) => kind), ...Object.values(BOX_ALSO).flat()] as const

/** Kinds that belong to a feature behind a flag, and the flag: the box shows only where it is on. */
const BEHIND: Partial<Record<OptionalNotificationKind, 'games' | 'communityAnnouncements'>> = {
  chess_challenge: 'games',
  chess_game_started: 'games',
  community_announcement: 'communityAnnouncements',
}

/**
 * The boxes to show a member, and the kinds left out. A kind left out keeps what
 * it was, through a hidden field, so saving the form never changes it unseen.
 */
export function settingsFor(features: { games?: boolean; communityAnnouncements?: boolean }) {
  const shown = NOTIFICATION_SETTINGS.filter(({ kind }) => {
    const flag = BEHIND[kind]
    return !flag || features[flag] === true
  })
  const hidden = OPTIONAL_KINDS.filter((kind) => !shown.some((s) => s.kind === kind || (BOX_ALSO as Record<string, readonly string[]>)[s.kind]?.includes(kind)))
  return { shown, hidden }
}

export type OptionalNotificationKind = (typeof NOTIFICATION_SETTINGS)[number]['kind'] | (typeof BOX_ALSO)[keyof typeof BOX_ALSO][number]

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
  // A kind without a box goes with its box.
  for (const [box, also] of Object.entries(BOX_ALSO)) for (const kind of also) kinds[kind] = on.has(box) || on.has(kind)
  // The highlights box is on the form only while highlights are offered, which the
  // form says with `highlights-offered`. A form without it leaves that choice as it is.
  const highlights = formData.has('highlights-offered') ? { highlights: formData.has('highlights') } : {}
  return { email: formData.has('email'), ...highlights, ...kinds }
}
