/** The report page for a post; a reply in a Gist names the Gist, which is the only place it can be read. */
export const reportPostHref = (postId: string, gistId?: string | null): string =>
  gistId ? `/report?post=${postId}&gist=${gistId}` : `/report?post=${postId}`
