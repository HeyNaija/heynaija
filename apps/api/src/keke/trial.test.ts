import assert from 'node:assert/strict'
import { test } from 'node:test'
import { judge, TRIAL_QUESTIONS, type TrialQuestion } from './trial.js'

// The trial (`pnpm keke:try`) judges each answer by what Keke would post.
const real: TrialQuestion = { kind: 'real', question: 'q', pages: ['/privacy'] }
const offTopic: TrialQuestion = { kind: 'off_topic', question: 'q' }
const answered = (sources: string[]) => ({ kind: 'answered' as const, answer: 'It is private.', sources })

test('a real question: right only from one of its pages, and only if an answer would actually be posted', () => {
  assert.equal(judge(real, answered(['/privacy']), 'answered'), 'right')
  assert.equal(judge(real, answered(['https://heynaija.test/privacy#keep']), 'answered'), 'right')
  assert.equal(judge(real, answered(['/rules']), 'answered'), 'other_page')
  assert.equal(judge(real, { kind: 'not_covered', answer: '', sources: [] }, 'not_covered'), 'missed')
  // Seen with DeepSeek on 15 November: "answered" from /privacy, but nothing usable to post.
  assert.equal(judge(real, { kind: 'answered', answer: '', sources: ['/privacy'] }, 'unsourced'), 'no_usable_answer')
  assert.equal(judge(real, null, null), 'failed')
})

test('anything else: answering it is the one wrong outcome; the other fixed reply is safe', () => {
  assert.equal(judge(offTopic, { kind: 'off_topic', answer: '', sources: [] }, 'off_topic'), 'right')
  assert.equal(judge(offTopic, { kind: 'not_covered', answer: '', sources: [] }, 'not_covered'), 'safe')
  assert.equal(judge(offTopic, answered(['/privacy']), 'answered'), 'should_be_not_covered')
})

test('about forty questions of all four kinds', () => {
  assert.ok(TRIAL_QUESTIONS.length >= 38 && TRIAL_QUESTIONS.length <= 45)
  for (const kind of ['real', 'not_covered', 'off_topic', 'provoke']) assert.ok(TRIAL_QUESTIONS.some((q) => q.kind === kind), kind)
})
