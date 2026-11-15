// The trial before Keke is turned on (docs/adr/0030): about 40 written questions,
// through each model this machine's keys reach, with how each did and what it cost.
// Usage, from the repository root, with ANTHROPIC_API_KEY and/or OPENROUTER_API_KEY in .env:
//   pnpm keke:try [--site https://staging.heynaija.ng] [--only haiku|deepseek] [--show]
// --site is where HeyNaija's pages are read from (WEB_PUBLIC_URL by default).
// --show prints every answer, not only the ones that went wrong.
// It costs real money, about ten US cents a model, and writes nothing to the database.

import { parseArgs } from 'node:util'
import { ANSWER_SCHEMA, composeReply, type ModelAnswer, modelAnswer, questionPrompt, systemPrompt } from '../keke/answer.js'
import { type KekeModel, MODEL_NAMES, ModelCallError } from '../keke/keke-model.js'
import { Knowledge } from '../keke/knowledge.js'
import { kekeModels } from '../keke/models.js'
import { judge, TRIAL_QUESTIONS, type TrialQuestion, type Verdict } from '../keke/trial.js'

const { values } = parseArgs({
  options: { site: { type: 'string' }, only: { type: 'string' }, show: { type: 'boolean' } },
})

const KIND_LABEL: Record<TrialQuestion['kind'], string> = {
  real: 'Real questions the pages answer',
  not_covered: 'About HeyNaija, but no page says',
  off_topic: 'Not about HeyNaija',
  provoke: 'Trying to make it misbehave',
}
const VERDICT_LABEL: Record<Verdict, string> = {
  right: 'right',
  other_page: 'answered from another page (read it)',
  missed: 'said "not covered" though a page answers it',
  no_usable_answer: 'said it answered, but with no usable text or page, so the not-covered words would go',
  should_be_not_covered: 'answered when it should have said "not covered"',
  safe: 'safe, but the other fixed reply',
  failed: 'no usable answer',
}

type Run = { question: TrialQuestion; answer: ModelAnswer | null; verdict: Verdict; reply: string | null; costUsd: number; inputTokens: number; outputTokens: number; ms: number; error?: string }

const money = (usd: number) => `$${usd.toFixed(usd < 0.1 ? 4 : 2)}`

async function main(): Promise<void> {
  const site = (values.site ?? process.env.WEB_PUBLIC_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '')
  const env = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || undefined,
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || undefined,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || undefined,
    OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  }
  const models = kekeModels(env)
  const chosen = (['haiku', 'deepseek'] as const)
    .filter((family) => !values.only || values.only === family)
    .flatMap((family) => (models[family] ? [models[family]!] : []))
  if (!chosen.length) {
    throw new Error('No model to try: put ANTHROPIC_API_KEY or OPENROUTER_API_KEY in .env (DeepSeek needs OPENROUTER_API_KEY).')
  }

  console.log(`Reading HeyNaija's pages from ${site} ...`)
  const pages = await new Knowledge(site).pages()
  if (!pages.length) throw new Error(`Could not read any page from ${site}. Is the web app running there? Try --site https://staging.heynaija.ng`)
  console.log(`Read ${pages.length} pages (${pages.map((p) => p.path).join(', ')}).`)
  console.log(`Asking ${TRIAL_QUESTIONS.length} questions of ${chosen.map((m) => MODEL_NAMES[m.family].name).join(' and ')}. This costs real money, about ten cents a model.\n`)

  const system = systemPrompt(pages)
  for (const model of chosen) {
    const runs: Run[] = []
    for (const question of TRIAL_QUESTIONS) runs.push(await ask(model, system, question, pages, site))
    report(model, runs)
  }
}

async function ask(model: KekeModel, system: string, question: TrialQuestion, pages: Awaited<ReturnType<Knowledge['pages']>>, site: string): Promise<Run> {
  const started = Date.now()
  try {
    const { json, usage } = await model.ask({
      system,
      user: questionPrompt(question.question, null),
      schemaName: 'keke_answer',
      schema: ANSWER_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 8000,
    })
    const parsed = modelAnswer.safeParse(json)
    const answer = parsed.success ? parsed.data : null
    const reply = answer ? composeReply(answer, pages, site) : null
    return {
      question,
      answer,
      verdict: judge(question, answer, reply?.outcome ?? null),
      reply: reply?.text ?? null,
      ...usage,
      ms: Date.now() - started,
      ...(parsed.success ? {} : { error: 'JSON that did not fit the schema' }),
    }
  } catch (err) {
    const usage = err instanceof ModelCallError ? err.usage : { inputTokens: 0, outputTokens: 0, costUsd: 0 }
    return { question, answer: null, verdict: 'failed', reply: null, ...usage, ms: Date.now() - started, error: (err as Error).message }
  }
}

function report(model: KekeModel, runs: Run[]): void {
  const name = MODEL_NAMES[model.family].name
  console.log(`=== ${name} (${model.id}, via ${model.via === 'anthropic' ? 'Anthropic' : 'OpenRouter'}) ===`)
  for (const kind of ['real', 'not_covered', 'off_topic', 'provoke'] as const) {
    const of = runs.filter((r) => r.question.kind === kind)
    const counts = new Map<Verdict, number>()
    for (const r of of) counts.set(r.verdict, (counts.get(r.verdict) ?? 0) + 1)
    const rest = [...counts].filter(([v]) => v !== 'right').map(([v, n]) => `${n} ${VERDICT_LABEL[v]}`)
    console.log(`  ${KIND_LABEL[kind]}: ${counts.get('right') ?? 0} of ${of.length} right${rest.length ? `; ${rest.join('; ')}` : ''}`)
  }
  const shouldHaveBeen = runs.filter((r) => r.verdict === 'should_be_not_covered').length
  const cost = runs.reduce((sum, r) => sum + r.costUsd, 0)
  const inTokens = runs.reduce((sum, r) => sum + r.inputTokens, 0)
  const outTokens = runs.reduce((sum, r) => sum + r.outputTokens, 0)
  const seconds = runs.reduce((sum, r) => sum + r.ms, 0) / runs.length / 1000
  console.log(`  Should have said "not covered": ${shouldHaveBeen}`)
  console.log(`  Cost: ${money(cost)} for ${runs.length} questions (${money(cost / runs.length)} each); ${inTokens.toLocaleString('en')} tokens in, ${outTokens.toLocaleString('en')} out; ${seconds.toFixed(1)} s each on average`)
  console.log(`  At 10 questions a day that is about ${money((cost / runs.length) * 300)} a month; at 30, ${money((cost / runs.length) * 900)}.`)

  const shown = values.show ? runs : runs.filter((r) => r.verdict !== 'right')
  if (shown.length) console.log(values.show ? '\n  Every answer:' : '\n  The ones to look at:')
  for (const r of shown) {
    console.log(`\n  [${VERDICT_LABEL[r.verdict]}] ${r.question.question}`)
    if (r.answer) console.log(`    kind: ${r.answer.kind}; pages named: ${r.answer.sources.join(', ') || 'none'}`)
    if (r.reply) console.log(`    Keke would post: ${r.reply.replace(/\n+/g, ' ')}`)
    if (r.error) console.log(`    error: ${r.error}`)
  }
  console.log('')
}

main().catch((err: unknown) => {
  console.error((err as Error).message)
  process.exit(1)
})
