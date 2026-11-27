// A round's questions as a JSON file (docs/adr/0028, phase 7). A host imports a
// file into the round form instead of typing each question, and downloads a saved
// round's questions from the console to use them again. Pictures are not in the
// file: each uploaded picture can be on one question only.

export const TRIVIA_FILE_FORMAT = 'heynaija-trivia'
export const TRIVIA_FILE_VERSION = 1

// The API's limits (apps/api/src/games/trivia/trivia.service.ts). It checks them
// again on save; checking here names the problem while the file is still open.
export const MAX_QUESTIONS = 30
const TITLE_MAX = 80
const PROMPT_MAX = 300
const CHOICE_MAX = 80
const ANSWER_MAX = 80
const ACCEPTED_MAX = 10
/** Errors shown at once; a file with more gets "and N more". */
const ERRORS_SHOWN = 5

/** One question as the form and the file both hold it. */
export type FileQuestion =
  | { kind: 'choice'; prompt: string; choices: string[]; correctChoice: number; explanation: string }
  | { kind: 'typed'; prompt: string; accepted: string[]; explanation: string }

export type ReadFile = { ok: true; title: string; questions: FileQuestion[] } | { ok: false; errors: string[] }

/** An example a host can copy. */
export const EXAMPLE_FILE = `{
  "title": "Naija Music Night",
  "questions": [
    {
      "question": "Which city is Burna Boy from?",
      "choices": ["Lagos", "Port Harcourt", "Abuja", "Enugu"],
      "answer": "Port Harcourt"
    },
    {
      "question": "Who sang \\"Ye\\" in 2018?",
      "answers": ["Burna Boy", "Burna"],
      "note": "It was on his album Outside."
    }
  ]
}`

const questionsCount = (n: number) => `${n} ${n === 1 ? 'question' : 'questions'}`
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const hasLetters = (s: string) => /[\p{L}\p{N}]/u.test(s)

/** A text field that may be left out; `null` when it is there but not text. */
function text(v: unknown): string | null {
  if (v === undefined || v === null) return ''
  if (typeof v === 'number') return String(v)
  return typeof v === 'string' ? v.trim() : null
}

/** Reads one question, or says what is wrong with it. */
function question(raw: unknown, n: number): FileQuestion | string[] {
  if (!isRecord(raw)) return [`Question ${n} is not written as { "question": …, … }.`]
  const errors: string[] = []
  const prompt = text(raw.question)
  if (prompt === null || !prompt) errors.push(`Question ${n} has no "question" text.`)
  else if (prompt.length > PROMPT_MAX) errors.push(`Question ${n} is longer than ${PROMPT_MAX} characters.`)
  const explanation = text(raw.note)
  if (explanation === null) errors.push(`Question ${n}’s "note" is not text.`)
  else if (explanation.length > PROMPT_MAX) errors.push(`Question ${n}’s note is longer than ${PROMPT_MAX} characters.`)

  if (raw.choices !== undefined) {
    if (raw.answers !== undefined) errors.push(`Question ${n} has both "choices" and "answers". Give choices with one "answer", or "answers" without choices.`)
    const choices = Array.isArray(raw.choices) ? raw.choices.map(text) : null
    if (!choices || choices.some((c) => c === null)) {
      errors.push(`Question ${n}’s "choices" must be a list of text.`)
      return errors
    }
    const kept = choices as string[]
    if (kept.length < 2 || kept.length > 4) errors.push(`Question ${n} has ${kept.length} ${kept.length === 1 ? 'choice' : 'choices'}. Give 2 to 4.`)
    if (kept.some((c) => !c)) errors.push(`Question ${n} has an empty choice.`)
    if (kept.some((c) => c.length > CHOICE_MAX)) errors.push(`Question ${n} has a choice longer than ${CHOICE_MAX} characters.`)
    if (new Set(kept.map((c) => c.toLowerCase())).size !== kept.length) errors.push(`Question ${n} has the same choice twice.`)
    const answer = text(raw.answer)
    const correctChoice = answer ? kept.findIndex((c) => c.toLowerCase() === answer.toLowerCase()) : -1
    if (answer === null || !answer) errors.push(`Question ${n} needs an "answer": the right choice, written as it is in "choices".`)
    else if (correctChoice < 0 && typeof raw.answer === 'number') errors.push(`Question ${n}’s answer is a number. Write the right choice itself, as it is in "choices".`)
    else if (correctChoice < 0) errors.push(`Question ${n}’s answer "${answer}" is not one of its choices.`)
    if (errors.length) return errors
    return { kind: 'choice', prompt: prompt!, choices: kept, correctChoice, explanation: explanation! }
  }

  // A typed question: "answers" is the list, and one "answer" is fine too.
  const given = raw.answers ?? raw.answer
  const list = Array.isArray(given) ? given.map(text) : given === undefined ? [] : [text(given)]
  if (list.some((a) => a === null)) {
    errors.push(`Question ${n}’s "answers" must be text, or a list of text.`)
    return errors
  }
  const accepted = [...new Set((list as string[]).filter(Boolean))]
  if (!accepted.length) errors.push(`Question ${n} needs "choices" with an "answer", or a list of "answers" to type.`)
  else if (accepted.length > ACCEPTED_MAX) errors.push(`Question ${n} has ${accepted.length} answers. Give up to ${ACCEPTED_MAX}.`)
  if (accepted.some((a) => a.length > ANSWER_MAX)) errors.push(`Question ${n} has an answer longer than ${ANSWER_MAX} characters.`)
  if (accepted.some((a) => !hasLetters(a))) errors.push(`Question ${n} has an answer with no letters or numbers in it.`)
  if (errors.length) return errors
  return { kind: 'typed', prompt: prompt!, accepted, explanation: explanation! }
}

/**
 * Reads a trivia file: `{ "title", "questions": [...] }`, or just the list of
 * questions. Every problem is listed, so the host can fix them in one go. `room`
 * is how many more questions the round can take.
 */
export function readTriviaFile(source: string, room = MAX_QUESTIONS): ReadFile {
  let data: unknown
  try {
    data = JSON.parse(source.replace(/^﻿/, ''))
  } catch (e) {
    return { ok: false, errors: [`That file is not valid JSON. Check for a missing comma, bracket or quote mark. (${(e as Error).message})`] }
  }
  if (isRecord(data) && data.format !== undefined && data.format !== TRIVIA_FILE_FORMAT) {
    return { ok: false, errors: ['That is not a HeyNaija trivia file.'] }
  }
  if (isRecord(data) && typeof data.version === 'number' && data.version > TRIVIA_FILE_VERSION) {
    return { ok: false, errors: ['That file is from a newer version of HeyNaija. Reload the page and try again.'] }
  }
  const list = Array.isArray(data) ? data : isRecord(data) ? data.questions : undefined
  if (!Array.isArray(list)) return { ok: false, errors: ['That file has no "questions" list.'] }
  if (!list.length) return { ok: false, errors: ['That file has no questions in it.'] }
  if (list.length > room) {
    return {
      ok: false,
      errors: [
        room === MAX_QUESTIONS
          ? `That file has ${questionsCount(list.length)}. A round can have up to ${MAX_QUESTIONS}.`
          : `That file has ${questionsCount(list.length)}, and the form has room for ${room} more. A round can have up to ${MAX_QUESTIONS}.`,
      ],
    }
  }
  const title = isRecord(data) ? text(data.title) : ''
  const errors: string[] = []
  if (title === null) errors.push('The "title" is not text.')
  else if (title.length > TITLE_MAX) errors.push(`The title is longer than ${TITLE_MAX} characters.`)
  const questions: FileQuestion[] = []
  list.forEach((raw, i) => {
    const q = question(raw, i + 1)
    if (Array.isArray(q)) errors.push(...q)
    else questions.push(q)
  })
  if (errors.length) {
    const more = errors.length - ERRORS_SHOWN
    return { ok: false, errors: more > 0 ? [...errors.slice(0, ERRORS_SHOWN), `And ${more} more ${more === 1 ? 'problem' : 'problems'}.`] : errors }
  }
  return { ok: true, title: title!, questions }
}

/** A round's questions as a file to download and import again later. */
export function writeTriviaFile(title: string, questions: FileQuestion[]): string {
  const file = {
    format: TRIVIA_FILE_FORMAT,
    version: TRIVIA_FILE_VERSION,
    title,
    questions: questions.map((q) => ({
      question: q.prompt,
      ...(q.kind === 'choice' ? { choices: q.choices, answer: q.choices[q.correctChoice] ?? '' } : { answers: q.accepted }),
      ...(q.explanation ? { note: q.explanation } : {}),
    })),
  }
  return `${JSON.stringify(file, null, 2)}\n`
}

/** A file name from the round's title: "Naija Music Night" is naija-music-night.json. */
export function triviaFileName(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return `${slug || 'trivia-questions'}.json`
}
