'use client'

import { createContext, type ReactNode, useContext } from 'react'

const ConversationAuthor = createContext<string | null>(null)

/** One visible conversation root, shared by initial, expanded and newly posted rows. */
export function ThreadAuthorProvider({ authorId, children }: { authorId: string | null; children: ReactNode }) {
  return <ConversationAuthor.Provider value={authorId}>{children}</ConversationAuthor.Provider>
}

export function ThreadAuthorLabel({ authorId }: { authorId: string }) {
  const originalAuthor = useContext(ConversationAuthor)
  return originalAuthor === authorId ? <span className="thread-author-label">Author</span> : null
}
