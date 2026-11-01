import { derivePersonKey } from '../governance/rules.js'

/** The document behind an approved check, as far as a key needs it. Held in memory only, for as long as it takes to derive the key. */
export type DocumentRef = { issuingState: string; number: string }

/** Kept apart from NIN keys made with the same secret (governance/rules.ts): the provider label is part of what is signed. */
const PROVIDER = 'didit-document'

/** Upper case, and everything but letters and digits removed: "ab 12-34" and "AB1234" are one number. */
export const normaliseDocumentNumber = (raw: string): string => raw.toUpperCase().replace(/[^\p{L}\p{N}]/gu, '')

/**
 * The private key that lets one document verify one account: the same keyed HMAC
 * as the NIN person key (governance/rules.ts derivePersonKey, same
 * IDENTITY_KEY_SECRET), over the issuing country and the normalised document
 * number. Null when there is no usable document. It is never the number or a plain
 * hash of it, and it is personal data: restricted schema only, never returned.
 */
export function documentPersonKey(secret: string, document: DocumentRef | null): string | null {
  if (!document) return null
  const number = normaliseDocumentNumber(document.number)
  const country = document.issuingState.trim().toUpperCase()
  if (!number || !country) return null
  return derivePersonKey(secret, PROVIDER, `${country}\u0000${number}`)
}

/**
 * The document of the first approved ID check in a decision. Field names are from
 * Didit's decision response (https://docs.didit.me/sessions-api/retrieve-session,
 * `id_verifications[]`: `document_number`, `issuing_state`, an ISO country code) and
 * the ID verification page (https://docs.didit.me/core-technology/id-verification/overview).
 * `personal_number` is not used. Nothing else of the item is read.
 */
export function documentFromDecision(decision: unknown): DocumentRef | null {
  if (decision === null || typeof decision !== 'object') return null
  const items = (decision as { id_verifications?: unknown }).id_verifications
  if (!Array.isArray(items)) return null
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue
    const { status, document_number: number, issuing_state: state } = item as Record<string, unknown>
    if (status === 'Approved' && typeof number === 'string' && number !== '' && typeof state === 'string' && state !== '') {
      return { issuingState: state, number }
    }
  }
  return null
}
