// The seam for optional NIN identity verification. Nothing here is reachable
// from an endpoint: there is no verification route, and there must not be one
// until HeyNaija is an approved NINAuth verification partner and the privacy and
// security reviews in docs/governance/open-items.md are done. The planned flow
// is written up in docs/governance/identity-verification.md.
//
// Everything marked "requires provider confirmation" is an assumption about what
// NINAuth will give HeyNaija. Do not build on it until NIMC confirms it in the
// partner agreement and in its production API, not from example payloads.

/** What HeyNaija keeps from a successful verification. Never the NIN. */
export type ProviderResult = {
  /** Which provider answered, e.g. 'ninauth'. */
  provider: string
  /**
   * A stable, pseudonymous identifier the provider uses for this person, so one
   * person cannot verify two accounts. Requires provider confirmation: null when
   * the provider gives none, and then formal voting stays blocked.
   */
  subject: string | null
  /**
   * Whether the provider says the person is 18 or older. Requires provider
   * confirmation that it may share this; null when it does not.
   */
  over18: boolean | null
  verifiedAt: Date
  /** How long the result may be relied on. Requires provider confirmation. */
  expiresAt: Date | null
}

export type AuthorizationInput = { state: string; codeChallenge: string; redirectUri: string }
export type ExchangeInput = { code: string; codeVerifier: string; redirectUri: string }

export interface NinVerificationProvider {
  readonly id: string
  /**
   * Where to send the member to consent (NINAuth's QR, share-code or sign-in
   * page). `state` and the PKCE `codeChallenge` are generated and stored by
   * HeyNaija's server for this one attempt.
   */
  authorizationUrl(input: AuthorizationInput): URL
  /**
   * Server-to-server exchange of the one-time code from the callback, with the
   * PKCE verifier. An implementation must check the token's issuer, audience,
   * signature and expiry, reject a code or state seen before, and never log the
   * code, the tokens or the provider's response.
   */
  exchange(input: ExchangeInput): Promise<ProviderResult>
}

/** Verification is not available: switched off, or the provider refused. */
export class VerificationUnavailableError extends Error {
  constructor(message = 'identity verification is not available') {
    super(message)
  }
}

/**
 * The only provider HeyNaija has today. Every call fails, so wiring it in can
 * never produce a verification.
 */
export class DisabledNinProvider implements NinVerificationProvider {
  readonly id = 'disabled'

  authorizationUrl(_input: AuthorizationInput): URL {
    throw new VerificationUnavailableError()
  }

  exchange(_input: ExchangeInput): Promise<ProviderResult> {
    return Promise.reject(new VerificationUnavailableError())
  }
}
