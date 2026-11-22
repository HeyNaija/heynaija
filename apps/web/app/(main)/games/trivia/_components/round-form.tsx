'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, startTransition, useRef, useState, useSyncExternalStore } from 'react'
import { finishPostImageUpload, postImageStatus, startPostImageUpload } from '@/app/actions'
import { isGif, POST_IMAGE_TYPES, shrinkImage } from '@/app/ui/shrink-image'
import { formatTime, HOME_ZONE } from '@/app/ui/time'
import { EXAMPLE_FILE, MAX_QUESTIONS, readTriviaFile } from '@/lib/trivia-file'
import { triviaCall } from './call'
import { blankQuestion, draftFromFile, isBlankQuestion, type PictureDraft, type QuestionDraft, type RoundDraft } from './round-draft'
import { saveJsonFile } from './save-file'

// A host writes a round (docs/adr/0028, phase 7): its title, when, where The
// Arbiter posts it, and its questions. The API checks everything again.

// As for a post's pictures (app/ui/use-image-drafts.ts): sharp enough full screen, small enough to send from a phone.
const PICTURE_MAX_BYTES = 10 * 1024 * 1024
const PICTURE_LONGEST_EDGE = 2048
const ALT_MAX = 1000
/** Far more than 30 questions need; a larger file is not a trivia file. */
const FILE_MAX_BYTES = 1024 * 1024
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

const unchanging = () => () => {}

/**
 * The start time in the host's own zone, when that is not Lagos: the form asks for
 * Lagos time, and pages show each reader their own. Nothing on the server's render.
 */
function YourTime({ lagos }: { lagos: string }) {
  const zone = useSyncExternalStore(unchanging, () => Intl.DateTimeFormat().resolvedOptions().timeZone || HOME_ZONE, () => null)
  const at = new Date(`${lagos}:00+01:00`)
  if (!zone || Number.isNaN(at.getTime())) return null
  const yours = formatTime(at.toISOString(), 'posted', 0, zone)
  if (yours === formatTime(at.toISOString(), 'posted', 0, HOME_ZONE)) return null
  return <span className="field-hint">That is {yours} where you are.</span>
}

export function RoundForm({ defaults, communities }: { defaults: RoundDraft; communities: { slug: string; name: string }[] }) {
  const router = useRouter()
  const [draft, setDraft] = useState(defaults)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof RoundDraft>(key: K, value: RoundDraft[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const setQuestion = (i: number, change: Partial<QuestionDraft>) =>
    setDraft((d) => ({ ...d, questions: d.questions.map((q, j) => (j === i ? { ...q, ...change } : q)) }))
  const move = (i: number, by: -1 | 1) =>
    setDraft((d) => {
      const qs = [...d.questions]
      const j = i + by
      if (j < 0 || j >= qs.length) return d
      ;[qs[i], qs[j]] = [qs[j]!, qs[i]!]
      return { ...d, questions: qs }
    })
  // A round always keeps one question in the form, so removing the last one empties it instead.
  const remove = (i: number) =>
    setDraft((d) => ({ ...d, questions: d.questions.length === 1 ? [blankQuestion(d.questions[0]!.kind)] : d.questions.filter((_, j) => j !== i) }))
  // Starts again from an empty form: the title and every question go; the start time and settings stay.
  const [clearing, setClearing] = useState(false)
  const clear = () => {
    setDraft((d) => ({ ...d, title: '', questions: [blankQuestion('choice')] }))
    setClearing(false)
  }
  // Imported questions go after those already written; an empty one, like the one a new round starts with, makes way.
  const written = draft.questions.filter((q) => !isBlankQuestion(q)).length
  const addImported = (title: string, imported: QuestionDraft[]) =>
    setDraft((d) => ({ ...d, title: d.title.trim() ? d.title : title, questions: [...d.questions.filter((q) => !isBlankQuestion(q)), ...imported] }))

  // A picture is found again by its local preview, so moving or removing questions while it uploads is fine.
  const setPicture = (preview: string, change: Partial<PictureDraft>) =>
    setDraft((d) => ({ ...d, questions: d.questions.map((q) => (q.image?.preview === preview ? { ...q, image: { ...q.image, ...change } } : q)) }))

  /** Uploads a picture as a post image is uploaded: straight to storage, then checked and resized by the server. */
  const addPicture = async (i: number, file: File) => {
    const preview = URL.createObjectURL(file)
    setQuestion(i, { image: { mediaId: null, preview, status: 'uploading', error: null, alt: '' } })
    const failed = (error: string) => setPicture(preview, { status: 'failed', error })
    try {
      if (!POST_IMAGE_TYPES.includes(file.type)) return failed('Choose a JPEG, PNG, WebP or GIF image.')
      const image = isGif(file) ? file : await shrinkImage(file, { max: PICTURE_LONGEST_EDGE })
      if (image.size > PICTURE_MAX_BYTES) return failed('That picture is too large. The limit is 10 MB.')
      const ticket = await startPostImageUpload(image.type, image.size)
      if ('error' in ticket) return failed(ticket.error)
      setPicture(preview, { mediaId: ticket.mediaId })
      // Straight to storage: the picture never passes through our servers on the way in.
      const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers: { 'content-type': image.type }, body: image }).catch(() => null)
      if (!put?.ok) return failed('The upload did not go through. Check your connection, remove it and try again.')
      const done = await finishPostImageUpload(ticket.mediaId)
      if ('error' in done) return failed(done.error)
      if (done.status === 'ready') return setPicture(preview, { status: 'ready' })
      setPicture(preview, { status: 'processing' })
      // About two minutes: quick checks first, since most pictures take a second or two.
      for (let k = 0; k < 90; k++) {
        await wait(k < 5 ? 600 : 1500)
        const status = await postImageStatus(ticket.mediaId).catch(() => 'processing' as const)
        if (status === 'ready') return setPicture(preview, { status: 'ready' })
        if (status === 'failed') return failed('That picture cannot be used. Choose a JPEG, PNG, WebP or GIF image.')
        if (status === null) return failed('That upload has expired. Remove it and add it again.')
      }
      failed('This is taking too long. Remove the picture and try again.')
    } catch {
      failed('Something went wrong. Remove the picture and try again.')
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const waiting = draft.questions.findIndex((q) => q.image && q.image.status !== 'ready')
    if (waiting >= 0) {
      setError(`Question ${waiting + 1}’s picture is not ready. Wait for it to finish, or remove it.`)
      return
    }
    setBusy(true)
    setError(null)
    const body = {
      title: draft.title,
      community: draft.community || null,
      startsAt: `${draft.startsAt}:00+01:00`,
      secondsPerQuestion: draft.secondsPerQuestion,
      autoAdvance: draft.autoAdvance,
      questions: draft.questions.map((q) => {
        const image = q.image?.mediaId ? { id: q.image.mediaId, alt: q.image.alt } : null
        if (q.kind === 'typed') {
          return { kind: 'typed', prompt: q.prompt, accepted: q.accepted.split('\n').map((a) => a.trim()).filter(Boolean), explanation: q.explanation || null, image }
        }
        // Empty choice boxes are left out, and the right one keeps its place among those left.
        const kept = q.choices.map((text, i) => ({ text: text.trim(), i })).filter((c) => c.text)
        return {
          kind: 'choice',
          prompt: q.prompt,
          choices: kept.map((c) => c.text),
          correctChoice: kept.findIndex((c) => c.i === q.correctChoice),
          explanation: q.explanation || null,
          image,
        }
      }),
    }
    const res = draft.id ? await triviaCall(`/rounds/${draft.id}`, 'PUT', body) : await triviaCall<{ id: string }>('/rounds', 'POST', body)
    if (!res.ok) {
      setBusy(false)
      setError(res.message)
      return
    }
    const id = draft.id ?? (res.body as { id: string }).id
    // Next keeps this page as it was when the host comes back to it, so it is left
    // ready: not busy, and a new round's form empty again. In the navigation's
    // transition, so the form does not change before the console shows.
    startTransition(() => {
      setBusy(false)
      if (!draft.id) setDraft(defaults)
      router.push(`/games/trivia/rounds/${id}/host`)
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Title</span>
        <input className="field" required minLength={3} maxLength={80} value={draft.title} onChange={(e) => set('title', e.target.value)} placeholder="Anime Trivia Night" />
      </label>
      <div className="competition-times">
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Starts (Lagos time)</span>
          <input type="datetime-local" className="field" required value={draft.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
          <YourTime lagos={draft.startsAt} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Seconds a question</span>
          <input
            type="number"
            className="field"
            required
            min={10}
            max={60}
            value={draft.secondsPerQuestion}
            onChange={(e) => set('secondsPerQuestion', Number(e.target.value))}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Posted in</span>
        <select className="field" value={draft.community} disabled={draft.scheduled} onChange={(e) => set('community', e.target.value)}>
          <option value="">Game Night</option>
          {communities.map((c) => (
            <option key={c.slug} value={c.slug}>{c.name}</option>
          ))}
        </select>
        <span className="field-hint">
          {draft.scheduled
            ? 'The Arbiter has posted this round here, so it stays here. Changes to its time, title or questions are posted in its thread.'
            : 'The Arbiter posts the round’s thread, each answer and the results there.'}
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={draft.autoAdvance} onChange={(e) => set('autoAdvance', e.target.checked)} />
        <span>
          Go on by itself: after each answer is shown, the next question opens 8 seconds later. Otherwise you open each one.
        </span>
      </label>

      <ImportQuestions room={MAX_QUESTIONS - written} onImport={addImported} />

      {written > 0 || draft.title.trim() ? (
        <div className="flex flex-wrap items-center gap-2">
          {clearing ? (
            <>
              <button type="button" className="btn btn-primary btn-sm" onClick={clear}>
                Yes, clear the title and {written} {written === 1 ? 'question' : 'questions'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setClearing(false)}>Keep them</button>
              <span className="text-sm text-muted">The start time and settings stay.</span>
            </>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setClearing(true)}>Clear the form</button>
          )}
        </div>
      ) : null}

      <ol className="flex flex-col gap-3">
        {draft.questions.map((q, i) => (
          <li key={i} className="trivia-edit">
            <fieldset className="flex flex-col gap-3">
              <legend className="field-label">Question {i + 1}</legend>
              <div className="flex flex-wrap gap-3 text-sm" role="radiogroup" aria-label={`Question ${i + 1}: how it is answered`}>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={q.kind === 'choice'} onChange={() => setQuestion(i, { kind: 'choice' })} /> Choices
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={q.kind === 'typed'} onChange={() => setQuestion(i, { kind: 'typed' })} /> Typed answer
                </label>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="sr-only">Question {i + 1}</span>
                <textarea className="field" rows={2} required maxLength={300} value={q.prompt} onChange={(e) => setQuestion(i, { prompt: e.target.value })} placeholder="Who wrote the first name in the Death Note?" />
              </label>
              {q.kind === 'choice' ? (
                <div className="flex flex-col gap-2">
                  <span className="field-hint">Two to four choices. Pick the right one.</span>
                  {q.choices.map((c, k) => (
                    <div key={k} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`right-${i}`}
                        aria-label={`Choice ${k + 1} is right`}
                        checked={q.correctChoice === k}
                        onChange={() => setQuestion(i, { correctChoice: k })}
                      />
                      <input
                        className="field flex-1"
                        maxLength={80}
                        required={k < 2}
                        value={c}
                        aria-label={`Choice ${k + 1}`}
                        onChange={(e) => setQuestion(i, { choices: q.choices.map((x, m) => (m === k ? e.target.value : x)) })}
                        placeholder={k < 2 ? `Choice ${k + 1}` : `Choice ${k + 1} (optional)`}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <label className="flex flex-col gap-1.5">
                  <span className="field-hint">Accepted answers, one a line. Capitals, accents, spaces and small typos in longer answers are forgiven already.</span>
                  <textarea className="field" rows={3} required value={q.accepted} onChange={(e) => setQuestion(i, { accepted: e.target.value })} placeholder={'Attack on Titan\nShingeki no Kyojin'} />
                </label>
              )}
              <PictureField
                n={i + 1}
                picture={q.image}
                onPick={(file) => void addPicture(i, file)}
                onDescribe={(alt) => q.image && setPicture(q.image.preview, { alt })}
                onRemove={() => setQuestion(i, { image: null })}
              />
              <label className="flex flex-col gap-1.5">
                <span className="field-hint">A note shown with the answer (optional)</span>
                <input className="field" maxLength={300} value={q.explanation} onChange={(e) => setQuestion(i, { explanation: e.target.value })} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => move(i, -1)} disabled={i === 0}>Move up</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => move(i, 1)} disabled={i === draft.questions.length - 1}>Move down</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => remove(i)} disabled={draft.questions.length === 1 && isBlankQuestion(q)}>Remove</button>
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary" disabled={draft.questions.length >= MAX_QUESTIONS} onClick={() => set('questions', [...draft.questions, blankQuestion('choice')])}>
          Add a choices question
        </button>
        <button type="button" className="btn btn-secondary" disabled={draft.questions.length >= MAX_QUESTIONS} onClick={() => set('questions', [...draft.questions, blankQuestion('typed')])}>
          Add a typed question
        </button>
      </div>
      <p className="text-xs text-muted">
        {draft.scheduled
          ? 'It is on the schedule: saving changes it for everyone at once. '
          : 'Saving keeps it as a draft only you see. Put it on the schedule from your console: The Arbiter then posts it. '}
        A round cannot change once its first question has opened.
      </p>
      {error ? (
        <p className="text-sm text-danger" role="alert">{error}</p>
      ) : null}
      <div>
        <button type="submit" className="btn btn-primary" disabled={busy}>{draft.id ? 'Save changes' : 'Save draft'}</button>
      </div>
    </form>
  )
}

/**
 * Fills the form from a JSON file of questions, so a host need not type each one.
 * The file is read here in the browser; nothing is saved until the host saves.
 */
function ImportQuestions({ room, onImport }: { room: number; onImport: (title: string, questions: QuestionDraft[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  // False in the server's HTML and until hydration: a file chosen before then would go nowhere.
  const ready = useSyncExternalStore(unchanging, () => true, () => false)
  const [errors, setErrors] = useState<string[]>([])
  const [added, setAdded] = useState<string | null>(null)

  const read = async (file: File) => {
    setErrors([])
    setAdded(null)
    if (file.size > FILE_MAX_BYTES) return setErrors(['That file is too large to be a list of questions. The limit is 1 MB.'])
    const source = await file.text().catch(() => null)
    if (source === null) return setErrors(['That file could not be opened. Try again.'])
    const result = readTriviaFile(source, room)
    if (!result.ok) return setErrors(result.errors)
    onImport(result.title, result.questions.map(draftFromFile))
    const n = result.questions.length
    setAdded(`Added ${n} ${n === 1 ? 'question' : 'questions'} from ${file.name}. Check them, then save.`)
  }

  return (
    <div className="trivia-edit flex flex-col gap-2">
      <span className="field-label">Import questions</span>
      <p className="field-hint">
        Add many questions at once from a JSON file. They go after any questions already in the form.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary btn-sm" disabled={!ready || room <= 0} onClick={() => input.current?.click()}>
          Choose a file
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!ready} onClick={() => saveJsonFile('trivia-example.json', `${EXAMPLE_FILE}\n`)}>
          Download an example
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          tabIndex={-1}
          aria-label="Questions file"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void read(file)
          }}
        />
      </div>
      {room <= 0 ? <p className="field-hint">The round has {MAX_QUESTIONS} questions, the most it can have.</p> : null}
      <details className="text-sm">
        <summary className="field-hint">How to write the file</summary>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-muted">
          <li>Each question has a <code>&quot;question&quot;</code>.</li>
          <li>A question with choices has 2 to 4 <code>&quot;choices&quot;</code> and one <code>&quot;answer&quot;</code>. The answer is the right choice, written the same way.</li>
          <li>A typed question has <code>&quot;answers&quot;</code> instead: every answer that counts.</li>
          <li>A <code>&quot;note&quot;</code> is optional. Players see it with the answer.</li>
          <li>A <code>&quot;title&quot;</code> is optional. It fills the Title box if that is empty.</li>
          <li>Pictures cannot go in the file. Add them in the form after you import.</li>
        </ul>
        <pre className="trivia-file-example">{EXAMPLE_FILE}</pre>
      </details>
      {added ? <p className="text-sm" role="status">{added}</p> : null}
      {errors.length ? (
        <div className="text-sm text-danger" role="alert">
          <p>The file was not imported:</p>
          <ul className="list-disc pl-5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

const PICTURE_STATUS: Record<PictureDraft['status'], string> = {
  uploading: 'Uploading…',
  processing: 'Checking the picture…',
  ready: 'Ready. Players see it when the question opens, not before.',
  failed: '',
}

/** A question's one picture: add it, describe it, take it off again. */
function PictureField({
  n,
  picture,
  onPick,
  onDescribe,
  onRemove,
}: {
  n: number
  picture: PictureDraft | null
  onPick: (file: File) => void
  onDescribe: (alt: string) => void
  onRemove: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  if (!picture) {
    return (
      <div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => input.current?.click()}>
          Add a picture
        </button>
        <input
          ref={input}
          type="file"
          accept={POST_IMAGE_TYPES.join(',')}
          className="sr-only"
          tabIndex={-1}
          aria-label={`Picture for question ${n}`}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) onPick(file)
          }}
        />
      </div>
    )
  }
  return (
    <div className="trivia-picture-edit">
      {/* eslint-disable-next-line @next/next/no-img-element -- a local preview, or the already resized picture */}
      <img src={picture.preview} alt="" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className={picture.status === 'failed' ? 'text-sm text-danger' : 'text-xs text-muted'} role="status">
          {picture.status === 'failed' ? picture.error : PICTURE_STATUS[picture.status]}
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="field-hint">Describe the picture for people who cannot see it, without giving the answer away</span>
          <input className="field" required maxLength={ALT_MAX} value={picture.alt} aria-label={`Question ${n}: describe the picture`} onChange={(e) => onDescribe(e.target.value)} />
        </label>
        <div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRemove}>Remove picture</button>
        </div>
      </div>
    </div>
  )
}
