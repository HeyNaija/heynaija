/**
 * The model behind Keke (docs/adr/0030): one small interface, two ways of
 * reaching a model, and the choice between them. Everything Keke decides is in
 * code around this; the model only reads the pages and the question and answers
 * in JSON by a schema.
 */

/** The two models Keke can use. Which one answers a member is the kekeDeepSeek flag's to say. */
export type ModelFamily = 'haiku' | 'deepseek'

/** Who a call is sent to: Anthropic directly, or OpenRouter, which passes it to a host. */
export type ModelVia = 'anthropic' | 'openrouter'

export type ModelRequest = {
  system: string
  user: string
  /** A JSON schema the reply must follow, and a short name for it. */
  schemaName: string
  schema: Record<string, unknown>
  maxTokens: number
  /**
   * How long the whole call may take, in milliseconds, retries included. Without
   * it a question's limit applies: 30 seconds an attempt, with the usual retries.
   */
  timeoutMs?: number
}

/** How long a question waits for the model. */
export const ANSWER_TIMEOUT_MS = 30_000

/** What a call cost. Tokens as the model counted them, dollars as charged or as worked out from the price list. */
export type ModelUsage = { inputTokens: number; outputTokens: number; costUsd: number }

export const NO_USAGE: ModelUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 }

/**
 * Why a call gave no usable JSON: it failed (an error, a timeout, no host that
 * keeps nothing, an answer cut short or not JSON), or the model declined.
 */
export class ModelCallError extends Error {
  constructor(
    readonly reason: 'failed' | 'refused',
    message: string,
    readonly usage: ModelUsage = NO_USAGE,
  ) {
    super(message)
  }
}

export interface KekeModel {
  readonly family: ModelFamily
  readonly via: ModelVia
  /** The model's ID as sent to whoever runs it. */
  readonly id: string
  /** Throws ModelCallError when there is no usable JSON. */
  ask(request: ModelRequest): Promise<{ json: unknown; usage: ModelUsage }>
}

/** The models this server can reach, by its keys: Haiku by either, DeepSeek only through OpenRouter. */
export type KekeModels = { haiku: KekeModel | null; deepseek: KekeModel | null }

export const KEKE_MODELS = Symbol('KEKE_MODELS')

/**
 * Which model to ask first, and which once if that one fails. The kekeDeepSeek
 * flag on picks DeepSeek, where there is one; otherwise Haiku. Empty when this
 * server has no model at all.
 */
export function chooseModels(models: KekeModels, deepSeekOn: boolean): KekeModel[] {
  const first = deepSeekOn ? (models.deepseek ?? models.haiku) : (models.haiku ?? models.deepseek)
  const other = first === models.haiku ? models.deepseek : models.haiku
  return [first, other].filter((m): m is KekeModel => m !== null)
}

/** How a model is named to members, on /about/keke, /privacy and /mod. */
export const MODEL_NAMES: Record<ModelFamily, { name: string; maker: string }> = {
  haiku: { name: 'Claude Haiku 5.5', maker: 'Anthropic' },
  deepseek: { name: 'DeepSeek V4.1 Flash', maker: 'DeepSeek' },
}

/** JSON as models sometimes wrap it, in a ```json fence, read anyway. Throws if it is not JSON. */
export function parseModelJson(text: string): unknown {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text)
  return JSON.parse(fenced ? fenced[1]! : text)
}
