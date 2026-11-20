import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EXAMPLE_FILE, MAX_QUESTIONS, readTriviaFile, triviaFileName, writeTriviaFile } from '../lib/trivia-file.ts'

const read = (data, room) => readTriviaFile(typeof data === 'string' ? data : JSON.stringify(data), room)
const choice = (extra = {}) => ({ question: 'Which city is Burna Boy from?', choices: ['Lagos', 'Port Harcourt'], answer: 'Port Harcourt', ...extra })

test('the example file reads as two questions: one with choices, one typed', () => {
  const file = readTriviaFile(EXAMPLE_FILE)
  assert.equal(file.ok, true)
  assert.equal(file.title, 'Naija Music Night')
  assert.deepEqual(file.questions, [
    { kind: 'choice', prompt: 'Which city is Burna Boy from?', choices: ['Lagos', 'Port Harcourt', 'Abuja', 'Enugu'], correctChoice: 1, explanation: '' },
    { kind: 'typed', prompt: 'Who sang "Ye" in 2018?', accepted: ['Burna Boy', 'Burna'], explanation: 'It was on his album Outside.' },
  ])
})

test('a downloaded file imports as the same questions', () => {
  const questions = [
    { kind: 'choice', prompt: 'Q1', choices: ['A', 'B', 'C'], correctChoice: 2, explanation: 'Because C.' },
    { kind: 'typed', prompt: 'Q2', accepted: ['Jollof', 'Jollof rice'], explanation: '' },
  ]
  const text = writeTriviaFile('Food Night', questions)
  const file = readTriviaFile(text)
  assert.deepEqual(file, { ok: true, title: 'Food Night', questions })
  // A note is only written when there is one.
  assert.equal(JSON.parse(text).questions[1].note, undefined)
  assert.equal(JSON.parse(text).format, 'heynaija-trivia')
})

test('a bare list of questions, a single typed answer, and spaces around text are fine', () => {
  const file = read([choice(), { question: '  Capital of Nigeria? ', answer: ' Abuja ' }])
  assert.equal(file.ok, true)
  assert.equal(file.title, '')
  assert.deepEqual(file.questions[1], { kind: 'typed', prompt: 'Capital of Nigeria?', accepted: ['Abuja'], explanation: '' })
  // The right choice is matched without minding capitals; repeated typed answers are kept once.
  assert.equal(read([choice({ answer: 'port harcourt' })]).questions[0].correctChoice, 1)
  assert.deepEqual(read([{ question: 'Q', answers: ['Abuja', 'Abuja', ''] }]).questions[0].accepted, ['Abuja'])
  // A file saved with a byte-order mark still reads.
  assert.equal(readTriviaFile(`﻿${JSON.stringify([choice()])}`).ok, true)
})

test('a file that is not JSON, or not a trivia file, says so', () => {
  assert.match(read('{ "questions": [ }').errors[0], /^That file is not valid JSON/)
  assert.deepEqual(read({ format: 'something-else', questions: [choice()] }).errors, ['That is not a HeyNaija trivia file.'])
  assert.deepEqual(read({ version: 2, questions: [choice()] }).errors, ['That file is from a newer version of HeyNaija. Reload the page and try again.'])
  assert.deepEqual(read({ title: 'x' }).errors, ['That file has no "questions" list.'])
  assert.deepEqual(read({ questions: [] }).errors, ['That file has no questions in it.'])
})

test('a file larger than the round has room for is refused', () => {
  const many = Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => choice({ question: `Q${i}` }))
  assert.deepEqual(read(many).errors, [`That file has ${MAX_QUESTIONS + 1} questions. A round can have up to ${MAX_QUESTIONS}.`])
  assert.deepEqual(read([choice(), choice()], 1).errors, ['That file has 2 questions, and the form has room for 1 more. A round can have up to 30.'])
  assert.equal(read([choice()], 1).ok, true)
})

test('each problem names its question', () => {
  const file = read({
    questions: [
      { choices: ['A', 'B'], answer: 'A' },
      choice({ answer: 'Abuja' }),
      choice({ answer: 1 }),
      choice({ choices: ['A'], answer: 'A' }),
      choice({ choices: ['A', 'a'], answer: 'A' }),
    ],
  })
  assert.equal(file.ok, false)
  assert.deepEqual(file.errors, [
    'Question 1 has no "question" text.',
    'Question 2’s answer "Abuja" is not one of its choices.',
    'Question 3’s answer is a number. Write the right choice itself, as it is in "choices".',
    'Question 4 has 1 choice. Give 2 to 4.',
    'Question 5 has the same choice twice.',
  ])
  assert.deepEqual(read([{ question: 'Q' }]).errors, ['Question 1 needs "choices" with an "answer", or a list of "answers" to type.'])
  assert.deepEqual(read([choice({ answers: ['x'] })]).errors, ['Question 1 has both "choices" and "answers". Give choices with one "answer", or "answers" without choices.'])
  assert.deepEqual(read([choice({ answer: undefined })]).errors, ['Question 1 needs an "answer": the right choice, written as it is in "choices".'])
  assert.deepEqual(read([{ question: 'Q', answers: ['!!'] }]).errors, ['Question 1 has an answer with no letters or numbers in it.'])
  assert.deepEqual(read([{ question: 'Q', answers: [{}] }]).errors, ['Question 1’s "answers" must be text, or a list of text.'])
  assert.deepEqual(read(['Q']).errors, ['Question 1 is not written as { "question": …, … }.'])
})

test('lengths are checked as the API checks them', () => {
  const long = (n) => 'x'.repeat(n)
  assert.deepEqual(read([choice({ question: long(301) })]).errors, ['Question 1 is longer than 300 characters.'])
  assert.deepEqual(read([choice({ note: long(301) })]).errors, ['Question 1’s note is longer than 300 characters.'])
  assert.deepEqual(read([choice({ choices: ['A', long(81)], answer: 'A' })]).errors, ['Question 1 has a choice longer than 80 characters.'])
  assert.deepEqual(read([{ question: 'Q', answers: [long(81)] }]).errors, ['Question 1 has an answer longer than 80 characters.'])
  assert.deepEqual(read([{ question: 'Q', answers: Array.from({ length: 11 }, (_, i) => `a${i}`) }]).errors, ['Question 1 has 11 answers. Give up to 10.'])
  assert.deepEqual(read({ title: long(81), questions: [choice()] }).errors, ['The title is longer than 80 characters.'])
  assert.equal(read([choice({ question: long(300), choices: ['A', long(80)], answer: 'A' })]).ok, true)
})

test('only the first five problems are listed', () => {
  const file = read(Array.from({ length: 8 }, () => ({ question: 'Q' })))
  assert.equal(file.errors.length, 6)
  assert.equal(file.errors[5], 'And 3 more problems.')
  assert.equal(read(Array.from({ length: 6 }, () => ({ question: 'Q' }))).errors[5], 'And 1 more problem.')
})

test('the file is named after the round', () => {
  assert.equal(triviaFileName('Naija Music Night'), 'naija-music-night.json')
  assert.equal(triviaFileName('  Ọ̀rọ̀ & Pidgin: Round 2! '), 'oro-pidgin-round-2.json')
  assert.equal(triviaFileName('???'), 'trivia-questions.json')
  assert.ok(triviaFileName('a'.repeat(100)).length <= 65)
})
