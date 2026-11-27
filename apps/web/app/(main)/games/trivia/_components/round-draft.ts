// A round as the host's form edits it (docs/adr/0028, phase 7); shared by the server pages and the form.

/** A picture being added to a question: from choosing it to the server having checked it. */
export type PictureDraft = {
  /** The uploaded image's id, once the upload has started. */
  mediaId: string | null
  /** What the form shows: a local copy while uploading, the resized one once saved. */
  preview: string
  status: 'uploading' | 'processing' | 'ready' | 'failed'
  error: string | null
  /** For people who cannot see it. */
  alt: string
}

export type QuestionDraft = {
  kind: 'choice' | 'typed'
  prompt: string
  choices: string[]
  correctChoice: number
  /** One accepted answer a line. */
  accepted: string
  explanation: string
  image: PictureDraft | null
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
  image: null,
})
