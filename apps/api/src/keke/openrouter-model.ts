import { z } from 'zod'
import { ANSWER_TIMEOUT_MS, type KekeModel, ModelCallError, type ModelFamily, type ModelRequest, type ModelUsage, NO_USAGE, parseModelJson } from './keke-model.js'

/** The models as OpenRouter names them, checked against its model list on 14 November 2026. */
export const OPENROUTER_IDS: Record<ModelFamily, string> = {
  haiku: 'anthropic/claude-haiku-5.5',
  deepseek: 'deepseek/deepseek-v4.1-flash-1017',
}

// OpenRouter's prices on 14 November 2026, dollars per million tokens, used only
// if a response does not say what it cost (every response is meant to).
const LIST_PRICE: Record<ModelFamily, { input: number; output: number }> = {
  haiku: { input: 0.1, output: 0.5 },
  deepseek: { input: 0.038, output: 0.5 },
}

const RETRY_DELAYS_MS = [1_000, 3_000]

const completion = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable().optional() }), finish_reason: z.string().nullable().optional() }))
    .optional(),
  usage: z
    .object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), cost: z.number().optional() })
    .optional(),
  error: z.object({ message: z.string().optional(), code: z.union([z.number(), z.string()]).optional() }).optional(),
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Asks a model through OpenRouter's chat completions with plain `fetch`: JSON by
 * a strict schema, and two retries on rate limits, server errors and failed
 * connections. For a question each attempt has 30 seconds; a request with its own
 * `timeoutMs` (the morning's news) has that long for all its attempts. Only hosts that say they neither keep nor train on what is sent are
 * used (`data_collection: "deny"`), and only those that can follow the schema.
 * With no such host OpenRouter answers 404, and this fails rather than relaxing it.
 */
export class OpenRouterModel implements KekeModel {
  readonly via = 'openrouter' as const
  readonly id: string

  constructor(
    readonly family: ModelFamily,
    private readonly apiKey: string,
    private readonly baseUrl = 'https://openrouter.ai/api/v1',
  ) {
    this.id = OPENROUTER_IDS[family]
  }

  async ask(request: ModelRequest): Promise<{ json: unknown; usage: ModelUsage }> {
    const body = JSON.stringify({
      model: this.id,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      response_format: { type: 'json_schema', json_schema: { name: request.schemaName, strict: true, schema: request.schema } },
      provider: { data_collection: 'deny', require_parameters: true },
      reasoning: { effort: 'medium' },
      max_tokens: request.maxTokens,
    })
    // A request's own time limit covers every attempt; otherwise each attempt has a question's.
    const until = request.timeoutMs ? Date.now() + request.timeoutMs : null
    const attemptMs = () => (until === null ? ANSWER_TIMEOUT_MS : until - Date.now())
    for (let attempt = 0; ; attempt++) {
      if (attemptMs() <= 0) throw new ModelCallError('failed', 'OpenRouter did not answer in time')
      let res: Response
      try {
        res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(attemptMs()),
        })
      } catch (err) {
        if (attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]!)
          continue
        }
        throw new ModelCallError('failed', (err as Error).name === 'TimeoutError' ? 'OpenRouter did not answer in time' : 'could not reach OpenRouter')
      }
      if ((res.status === 429 || res.status >= 500) && attempt < RETRY_DELAYS_MS.length) {
        await res.body?.cancel()
        await sleep(RETRY_DELAYS_MS[attempt]!)
        continue
      }
      // OpenRouter answers 200 at once and sends the body when the model is done, so the time can run out while reading it.
      let reply: unknown = null
      try {
        reply = await res.json()
      } catch (err) {
        if ((err as Error).name === 'TimeoutError') throw new ModelCallError('failed', 'OpenRouter did not answer in time')
      }
      const parsed = completion.safeParse(reply)
      if (!parsed.success) throw new ModelCallError('failed', `OpenRouter answered ${res.status} with something unexpected`)
      const { choices, usage: reported, error } = parsed.data
      const usage = this.usageOf(reported)
      // 404 here is what OpenRouter says when no host meets the data policy.
      if (!res.ok || error) throw new ModelCallError('failed', `OpenRouter answered ${res.status}: ${error?.message ?? 'no detail'}`, usage)
      const choice = choices?.[0]
      if (choice?.finish_reason === 'content_filter') throw new ModelCallError('refused', 'the host declined', usage)
      if (!choice?.message.content || (choice.finish_reason && choice.finish_reason !== 'stop')) {
        throw new ModelCallError('failed', `stopped: ${choice?.finish_reason ?? 'no answer'}`, usage)
      }
      try {
        return { json: parseModelJson(choice.message.content), usage }
      } catch {
        throw new ModelCallError('failed', 'the answer was not JSON', usage)
      }
    }
  }

  private usageOf(reported: z.infer<typeof completion>['usage']): ModelUsage {
    if (!reported) return NO_USAGE
    const inputTokens = reported.prompt_tokens ?? 0
    const outputTokens = reported.completion_tokens ?? 0
    const price = LIST_PRICE[this.family]
    const costUsd = reported.cost ?? (inputTokens * price.input + outputTokens * price.output) / 1_000_000
    return { inputTokens, outputTokens, costUsd }
  }
}
