import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, test } from 'node:test'
import { AnthropicModel, HAIKU_ID, haikuCost } from './anthropic-model.js'
import { ModelCallError, type ModelRequest } from './keke-model.js'
import { kekeModels } from './models.js'
import { OPENROUTER_IDS, OpenRouterModel } from './openrouter-model.js'

// Stand-ins for Anthropic and OpenRouter on this machine: they record what was
// sent and answer what each test says, so no key and no money are needed.
/** `delayMs`: wait before answering at all; `delayBodyMs`: say the status at once and send the body later, as OpenRouter does. */
type Reply = { status: number; body: unknown; delayMs?: number; delayBodyMs?: number }
let replies: Reply[] = []
let received: { path: string; headers: IncomingMessage['headers']; body: Record<string, unknown> }[] = []
let server: Server
let base = ''

before(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      received.push({ path: req.url ?? '', headers: req.headers, body: JSON.parse(raw || '{}') })
      const reply = replies.shift() ?? { status: 500, body: { error: { message: 'no reply set' } } }
      setTimeout(() => {
        res.writeHead(reply.status, { 'content-type': 'application/json' })
        res.write(' ')
        setTimeout(() => res.end(JSON.stringify(reply.body)), reply.delayBodyMs ?? 0)
      }, reply.delayMs ?? 0)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => new Promise<void>((resolve) => server.close(() => resolve())))
beforeEach(() => {
  replies = []
  received = []
})

const request: ModelRequest = {
  system: 'pages',
  user: 'question',
  schemaName: 'keke_answer',
  schema: { type: 'object', properties: { kind: { type: 'string' } }, required: ['kind'], additionalProperties: false },
  maxTokens: 8000,
}

const message = (text: string, stop = 'end_turn', usage = { input_tokens: 20_000, output_tokens: 400 }) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: HAIKU_ID,
  content: [{ type: 'text', text }],
  stop_reason: stop,
  stop_sequence: null,
  usage,
})

test('Anthropic: Haiku 5.5 with JSON by schema and effort set, and the cost worked out from its prices', async () => {
  replies = [{ status: 200, body: message('{"kind":"answered"}') }]
  const { json, usage } = await new AnthropicModel('sk-test', base).ask(request)
  assert.deepEqual(json, { kind: 'answered' })
  assert.deepEqual(usage, { inputTokens: 20_000, outputTokens: 400, costUsd: (20_000 * 0.1 + 400 * 0.5) / 1e6 })
  const [sent] = received
  assert.equal(sent!.path, '/v1/messages')
  // The SDK sends the key as a bearer token, with the API version it was built for.
  assert.equal(sent!.headers.authorization, 'Bearer sk-test')
  assert.equal(sent!.body.model, 'claude-haiku-5-5')
  assert.equal(sent!.body.system, 'pages')
  assert.deepEqual(sent!.body.messages, [{ role: 'user', content: 'question' }])
  assert.deepEqual(sent!.body.output_config, { effort: 'medium', format: { type: 'json_schema', schema: request.schema } })
  assert.equal('temperature' in sent!.body, false)
})

test('Anthropic: a refusal, an answer cut short or one that is not JSON is no answer, and still costs', async () => {
  replies = [{ status: 200, body: { ...message(''), content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null } } }]
  const refused = await new AnthropicModel('k', base).ask(request).catch((e: unknown) => e)
  assert.ok(refused instanceof ModelCallError && refused.reason === 'refused' && refused.usage.inputTokens === 20_000)
  replies = [{ status: 200, body: message('{"kind":', 'max_tokens') }]
  const cut = await new AnthropicModel('k', base).ask(request).catch((e: unknown) => e)
  assert.ok(cut instanceof ModelCallError && cut.reason === 'failed')
  replies = [{ status: 200, body: message('Sure! Here you go.') }]
  const prose = await new AnthropicModel('k', base).ask(request).catch((e: unknown) => e)
  assert.ok(prose instanceof ModelCallError && prose.reason === 'failed' && prose.usage.outputTokens === 400)
})

test('Anthropic: an error answer is a failure with nothing spent', async () => {
  replies = [{ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }]
  const err = await new AnthropicModel('bad', base).ask(request).catch((e: unknown) => e)
  assert.ok(err instanceof ModelCallError)
  assert.equal(err.message, 'Anthropic refused the key')
  assert.equal(err.usage.costUsd, 0)
})

test('Haiku’s price goes up for prompts over 100,000 tokens', () => {
  assert.equal(haikuCost(100_000, 1_000), (100_000 * 0.1 + 1_000 * 0.5) / 1e6)
  assert.equal(haikuCost(100_001, 1_000), (100_001 * 0.5 + 1_000 * 2.5) / 1e6)
})

const completion = (content: string, usage: Record<string, number> = { prompt_tokens: 20_000, completion_tokens: 300, cost: 0.00091 }, finish = 'stop') => ({
  choices: [{ message: { role: 'assistant', content }, finish_reason: finish }],
  usage,
})

test('OpenRouter: a strict schema, only hosts that keep nothing, and the cost as it reports it', async () => {
  replies = [{ status: 200, body: completion('{"kind":"off_topic"}') }]
  const { json, usage } = await new OpenRouterModel('deepseek', 'or-key', base).ask(request)
  assert.deepEqual(json, { kind: 'off_topic' })
  assert.deepEqual(usage, { inputTokens: 20_000, outputTokens: 300, costUsd: 0.00091 })
  const [sent] = received
  assert.equal(sent!.path, '/chat/completions')
  assert.equal(sent!.headers.authorization, 'Bearer or-key')
  assert.equal(sent!.body.model, 'deepseek/deepseek-v4.1-flash-1017')
  assert.deepEqual(sent!.body.messages, [{ role: 'system', content: 'pages' }, { role: 'user', content: 'question' }])
  assert.deepEqual(sent!.body.response_format, { type: 'json_schema', json_schema: { name: 'keke_answer', strict: true, schema: request.schema } })
  assert.deepEqual(sent!.body.provider, { data_collection: 'deny', require_parameters: true })
})

test('OpenRouter: tries again twice on rate limits and server errors, then gives up', async () => {
  replies = [{ status: 429, body: {} }, { status: 502, body: {} }, { status: 200, body: completion('{"kind":"answered"}') }]
  assert.deepEqual((await new OpenRouterModel('haiku', 'k', base).ask(request)).json, { kind: 'answered' })
  assert.equal(received.length, 3)
  assert.equal(received[0]!.body.model, OPENROUTER_IDS.haiku)

  replies = [{ status: 503, body: {} }, { status: 503, body: {} }, { status: 503, body: {} }]
  received = []
  await assert.rejects(new OpenRouterModel('haiku', 'k', base).ask(request), ModelCallError)
  assert.equal(received.length, 3)
})

test('the morning’s news may take longer than a question: a slow model times out at the request’s limit, not before', async () => {
  // Anthropic: the limit is for one attempt, with no retry (the draft has another model, and tries again later).
  replies = [{ status: 200, body: message('{"kind":"answered"}'), delayMs: 400 }]
  const slow = await new AnthropicModel('k', base).ask({ ...request, timeoutMs: 150 }).catch((e: unknown) => e)
  assert.ok(slow instanceof ModelCallError && slow.message === 'Anthropic did not answer in time')
  assert.equal(received.length, 1)
  replies = [{ status: 200, body: message('{"kind":"answered"}'), delayMs: 400 }]
  assert.deepEqual((await new AnthropicModel('k', base).ask({ ...request, timeoutMs: 5000 })).json, { kind: 'answered' })

  // OpenRouter says 200 at once and sends the answer when it is done: running out of time then says so.
  replies = [{ status: 200, body: completion('{"kind":"answered"}'), delayBodyMs: 400 }]
  const late = await new OpenRouterModel('deepseek', 'k', base).ask({ ...request, timeoutMs: 150 }).catch((e: unknown) => e)
  assert.ok(late instanceof ModelCallError && late.message === 'OpenRouter did not answer in time')
  replies = [{ status: 200, body: completion('{"kind":"answered"}'), delayBodyMs: 400 }]
  assert.deepEqual((await new OpenRouterModel('deepseek', 'k', base).ask({ ...request, timeoutMs: 5000 })).json, { kind: 'answered' })

  // The limit covers OpenRouter's retries too: no answer before it, and no attempt after it.
  replies = [{ status: 200, body: completion('{"kind":"answered"}'), delayMs: 400 }]
  received = []
  const none = await new OpenRouterModel('deepseek', 'k', base).ask({ ...request, timeoutMs: 150 }).catch((e: unknown) => e)
  assert.ok(none instanceof ModelCallError && none.message === 'OpenRouter did not answer in time')
  assert.equal(received.length, 1)
})

test('OpenRouter: no host that keeps nothing is a failure, not a quiet switch to one that does', async () => {
  replies = [{ status: 404, body: { error: { code: 404, message: 'No endpoints found matching your data policy' } } }]
  const err = await new OpenRouterModel('deepseek', 'k', base).ask(request).catch((e: unknown) => e)
  assert.ok(err instanceof ModelCallError && err.reason === 'failed')
  assert.match(err.message, /data policy/)
  assert.equal(received.length, 1)
})

test('OpenRouter: a fenced answer is read; prose, a filtered answer or one cut short is not', async () => {
  replies = [{ status: 200, body: completion('```json\n{"kind":"not_covered"}\n```') }]
  assert.deepEqual((await new OpenRouterModel('deepseek', 'k', base).ask(request)).json, { kind: 'not_covered' })
  replies = [{ status: 200, body: completion('I cannot help', undefined, 'content_filter') }]
  assert.equal(((await new OpenRouterModel('deepseek', 'k', base).ask(request).catch((e: unknown) => e)) as ModelCallError).reason, 'refused')
  replies = [{ status: 200, body: completion('{"kind":', undefined, 'length') }]
  assert.equal(((await new OpenRouterModel('deepseek', 'k', base).ask(request).catch((e: unknown) => e)) as ModelCallError).reason, 'failed')
  // No reported cost: worked out from the list price.
  replies = [{ status: 200, body: completion('{"kind":"answered"}', { prompt_tokens: 1_000_000, completion_tokens: 0 }) }]
  assert.equal((await new OpenRouterModel('deepseek', 'k', base).ask(request)).usage.costUsd, 0.038)
})

test('which keys reach which models: either key turns Keke on', () => {
  const none = kekeModels({ OPENROUTER_BASE_URL: base })
  assert.deepEqual(none, { haiku: null, deepseek: null })
  const anthropicOnly = kekeModels({ ANTHROPIC_API_KEY: 'a', OPENROUTER_BASE_URL: base })
  assert.equal(anthropicOnly.haiku?.via, 'anthropic')
  assert.equal(anthropicOnly.deepseek, null)
  const openRouterOnly = kekeModels({ OPENROUTER_API_KEY: 'o', OPENROUTER_BASE_URL: base })
  assert.deepEqual([openRouterOnly.haiku?.via, openRouterOnly.haiku?.id], ['openrouter', 'anthropic/claude-haiku-5.5'])
  assert.equal(openRouterOnly.deepseek?.via, 'openrouter')
  const both = kekeModels({ ANTHROPIC_API_KEY: 'a', OPENROUTER_API_KEY: 'o', OPENROUTER_BASE_URL: base })
  assert.deepEqual([both.haiku?.via, both.deepseek?.via], ['anthropic', 'openrouter'])
})
