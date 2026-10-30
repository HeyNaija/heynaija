'use client'

import { createContext, type ReactNode, useContext } from 'react'

const ConversationAuthor = createContext<string | null>(null)

/** One visible conversation root, shared by initial, expanded and newly posted rows. */
export function ThreadAuthorProvider({ authorId, children }: { authorId: string | null; children: ReactNode }) {
  return <ConversationAuthor.Provider value={authorId}>{children}</ConversationAuthor.Provider>
}

/** `separator` puts a dot before it, for a line of details such as the focused post's. */
export function ThreadAuthorLabel({ authorId, separator = false }: { authorId: string; separator?: boolean }) {
  const originalAuthor = useContext(ConversationAuthor)
  if (originalAuthor !== authorId) return null
  const label = <span className="thread-author-label">Author</span>
  return separator ? <><span aria-hidden="true">·</span>{label}</> : label
}
