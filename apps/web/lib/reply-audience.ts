/** Who may reply to a conversation, as its first post's author chose. Matches the API's `REPLY_AUDIENCES`. */
export const REPLY_AUDIENCES = ['everyone', 'following', 'mentioned'] as const

export type ReplyAudience = (typeof REPLY_AUDIENCES)[number]

export const isReplyAudience = (value: string): value is ReplyAudience => (REPLY_AUDIENCES as readonly string[]).includes(value)

/** A Gist's host may also close its comment section. Matches the API's `GIST_REPLY_AUDIENCES`. */
export const GIST_REPLY_AUDIENCES = [...REPLY_AUDIENCES, 'off'] as const

export type GistReplyAudience = (typeof GIST_REPLY_AUDIENCES)[number]

export const isGistReplyAudience = (value: string): value is GistReplyAudience =>
  (GIST_REPLY_AUDIENCES as readonly string[]).includes(value)

export const GIST_REPLY_AUDIENCE_LABEL = {
  everyone: 'Everyone can reply',
  following: 'People you follow can reply',
  mentioned: 'Only people you mention can reply',
  off: 'Replies off',
} satisfies Record<GistReplyAudience, string>
