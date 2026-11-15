import type { Env } from '../env.js'
import { AnthropicModel } from './anthropic-model.js'
import type { KekeModels } from './keke-model.js'
import { OpenRouterModel } from './openrouter-model.js'

/**
 * The models this server's keys reach (docs/adr/0030). Claude Haiku 5.5 goes
 * directly to Anthropic when ANTHROPIC_API_KEY is set, otherwise through
 * OpenRouter; DeepSeek V4.1 Flash only ever goes through OpenRouter.
 */
export function kekeModels(env: Pick<Env, 'ANTHROPIC_API_KEY' | 'ANTHROPIC_BASE_URL' | 'OPENROUTER_API_KEY' | 'OPENROUTER_BASE_URL'>): KekeModels {
  const openRouter = env.OPENROUTER_API_KEY
  return {
    haiku: env.ANTHROPIC_API_KEY
      ? new AnthropicModel(env.ANTHROPIC_API_KEY, env.ANTHROPIC_BASE_URL)
      : openRouter
        ? new OpenRouterModel('haiku', openRouter, env.OPENROUTER_BASE_URL)
        : null,
    deepseek: openRouter ? new OpenRouterModel('deepseek', openRouter, env.OPENROUTER_BASE_URL) : null,
  }
}
