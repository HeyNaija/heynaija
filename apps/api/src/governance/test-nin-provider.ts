import {
  type AuthorizationInput,
  type ExchangeInput,
  type NinVerificationProvider,
  type ProviderResult,
  VerificationUnavailableError,
} from './nin-provider.js'

/**
 * A pretend NINAuth for automated tests: each code maps to a canned answer. It
 * refuses to be created anywhere but inside `node --test` (which sets
 * NODE_TEST_CONTEXT in the processes it runs) and never under
 * NODE_ENV=production, which is how staging and production run, so it cannot
 * stand in for a real provider on a server.
 */
export class TestNinProvider implements NinVerificationProvider {
  readonly id = 'test-ninauth'
  private readonly used = new Set<string>()

  constructor(private readonly answers: Record<string, Omit<ProviderResult, 'provider'>>) {
    if (process.env.NODE_ENV === 'production' || !process.env.NODE_TEST_CONTEXT) {
      throw new Error('TestNinProvider is only for automated tests')
    }
  }

  authorizationUrl(input: AuthorizationInput): URL {
    const url = new URL('https://ninauth.test/authorize')
    url.search = new URLSearchParams({
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
      redirect_uri: input.redirectUri,
    }).toString()
    return url
  }

  async exchange(input: ExchangeInput): Promise<ProviderResult> {
    const answer = this.answers[input.code]
    // A code works once, as a real provider's would.
    if (!answer || this.used.has(input.code)) throw new VerificationUnavailableError('unknown or reused code')
    this.used.add(input.code)
    return { provider: this.id, ...answer }
  }
}
