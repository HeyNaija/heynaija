/** Who may reply to a conversation, as its first post's author chose. Matches the API's `REPLY_AUDIENCES`. */
export const REPLY_AUDIENCES = ['everyone', 'following', 'mentioned'] as const

export type ReplyAudience = (typeof REPLY_AUDIENCES)[number]

export const isReplyAudience = (value: string): value is ReplyAudience => (REPLY_AUDIENCES as readonly string[]).includes(value)
