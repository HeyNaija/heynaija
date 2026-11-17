import Anthropic from '@anthropic-ai/sdk'
import { ANSWER_TIMEOUT_MS, type KekeModel, ModelCallError, type ModelRequest, type ModelUsage, parseModelJson } from './keke-model.js'

/** Claude Haiku 5.5 on Anthropic's own API (docs/adr/0030). */
export const HAIKU_ID = 'claude-haiku-5-5'

// Anthropic's prices for Claude Haiku 5.5, in dollars per million tokens: one rate
// for prompts up to 100,000 tokens and a higher one beyond. Its responses report
// tokens, not dollars, so the cost record works it out from these.
const LONG_PROMPT = 100_000
const PRICE = { input: 0.1, output: 0.5 }
const LONG_PRICE = { input: 0.5, output: 2.5 }

export const haikuCost = (inputTokens: number, outputTokens: number): number => {
  const price = inputTokens > LONG_PROMPT ? LONG_PRICE : PRICE
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000
}

/** A short, safe description of a failed call: the kind of error, never the request. */
function describe(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Anthropic refused the key'
  if (err instanceof Anthropic.RateLimitError) return 'Anthropic is rate limiting us'
  if (err instanceof Anthropic.BadRequestError) return `Anthropic refused the request: ${err.message}`
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'Anthropic did not answer in time'
  if (err instanceof Anthropic.APIConnectionError) return 'could not reach Anthropic'
  if (err instanceof Anthropic.APIError) return `Anthropic answered ${err.status}`
  return (err as Error).message
}

/**
 * Asks Claude Haiku 5.5 directly, through Anthropic's SDK: JSON by schema
 * (structured outputs), a 30-second limit and the SDK's two retries on rate
 * limits and server errors. Thinking is on by default on this model; effort is
 * set rather than left to the default.
 */
export class AnthropicModel implements KekeModel {
  readonly family = 'haiku' as const
  readonly via = 'anthropic' as const
  readonly id = HAIKU_ID
  private readonly client: Anthropic

  constructor(apiKey: string, baseURL?: string) {
    this.client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}), timeout: ANSWER_TIMEOUT_MS, maxRetries: 2 })
  }

  async ask(request: ModelRequest): Promise<{ json: unknown; usage: ModelUsage }> {
    let response: Anthropic.Message
    try {
      response = await this.client.messages.create({
        model: HAIKU_ID,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: request.schema } },
      }, request.timeoutMs ? { timeout: request.timeoutMs, maxRetries: 1 } : undefined)
    } catch (err) {
      throw new ModelCallError('failed', describe(err))
    }
    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costUsd: haikuCost(response.usage.input_tokens, response.usage.output_tokens),
    }
    if (response.stop_reason === 'refusal') throw new ModelCallError('refused', `declined (${response.stop_details?.category ?? 'no category'})`, usage)
    if (response.stop_reason !== 'end_turn') throw new ModelCallError('failed', `stopped: ${response.stop_reason}`, usage)
    const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
    try {
      return { json: parseModelJson(text), usage }
    } catch {
      throw new ModelCallError('failed', 'the answer was not JSON', usage)
    }
  }
}
