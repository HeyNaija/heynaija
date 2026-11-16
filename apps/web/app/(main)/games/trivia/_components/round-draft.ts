// A round as the host's form edits it (docs/adr/0028, phase 7); shared by the server pages and the form.

export type QuestionDraft = {
  kind: 'choice' | 'typed'
  prompt: string
  choices: string[]
  correctChoice: number
  /** One accepted answer a line. */
  accepted: string
  explanation: string
}

export type RoundDraft = {
  id?: string
  title: string
  community: string
  /** Lagos time, as a datetime-local value. */
  startsAt: string
  /** On the schedule: The Arbiter has posted it, so its community is fixed. */
  scheduled?: boolean
  secondsPerQuestion: number
  autoAdvance: boolean
  questions: QuestionDraft[]
}

export const blankQuestion = (kind: QuestionDraft['kind'] = 'choice'): QuestionDraft => ({
  kind,
  prompt: '',
  choices: ['', '', '', ''],
  correctChoice: 0,
  accepted: '',
  explanation: '',
})
