import { gistReplyHref } from './thread-state.ts'

/** Where "View reply" goes after a reply is posted: a Gist's reply is not served on /p/, so it opens on the Gist. */
export const postedReplyHref = (gistId: string | null | undefined, postId: string): string =>
  gistId ? gistReplyHref(gistId, postId) : `/p/${postId}#post-${postId}`
