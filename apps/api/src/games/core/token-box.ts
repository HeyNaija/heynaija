import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Encrypts secrets kept for a member, such as their Lichess token (docs/adr/0018),
 * with AES-256-GCM. A box reads `v1.<iv>.<ciphertext>.<tag>` in base64url; the
 * version leaves room to change keys later. The member's id is bound in as
 * associated data, so a box copied onto another member's row does not open.
 */
export class TokenBox {
  private readonly key: Buffer

  /** `hexKey` is 32 bytes as 64 hex characters (GAMES_TOKEN_KEY). */
  constructor(hexKey: string) {
    if (!/^[0-9a-f]{64}$/i.test(hexKey)) throw new Error('the token key must be 64 hex characters')
    this.key = Buffer.from(hexKey, 'hex')
  }

  seal(plain: string, memberId: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(Buffer.from(memberId))
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    return ['v1', iv, body, cipher.getAuthTag()].map((part) => (typeof part === 'string' ? part : part.toString('base64url'))).join('.')
  }

  /** The secret, or throws if the box was altered, sealed for someone else or with another key. */
  open(box: string, memberId: string): string {
    const [version, iv, body, tag, ...rest] = box.split('.')
    if (version !== 'v1' || !iv || !body || !tag || rest.length) throw new Error('not a token box')
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'))
    decipher.setAAD(Buffer.from(memberId))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
  }
}
