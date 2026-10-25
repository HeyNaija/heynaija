// The welcome flow at /welcome: what its forms send, and where its links lead.
// Step 1's choices travel to step 2 in the URL (`c`, once per community), so
// every step is a plain link or form that works before JavaScript has loaded.

export type OnboardingStep = 'communities' | 'people' | 'notifications'

/** Where the flow ends: the Following feed, with its nudge to say hello. */
export const WELCOMED_HOME = '/?feed=following&welcome=1'

/** The communities and people the last form asks to join and follow. */
export type OnboardingChoices = { communities: string[]; follow: string[] }

const unique = (values: FormDataEntryValue[]) => [...new Set(values.map(String).filter(Boolean))]

/**
 * What the last form sends: the communities chosen in step 1 (hidden fields), and
 * the people ticked in step 2, or nobody when the member pressed "Skip this step".
 */
export function choicesFromForm(form: FormData): OnboardingChoices {
  return {
    communities: unique(form.getAll('community')),
    follow: form.get('people') === 'skip' ? [] : unique(form.getAll('follow')),
  }
}

/** /welcome at `step`, carrying the communities chosen so far and, after a failure, what went wrong. */
export function welcomePath(step: OnboardingStep, communities: string[], error?: 'busy' | 'failed'): string {
  const query = new URLSearchParams([
    ...(step === 'communities' ? [] : [['step', step]]),
    ...communities.map((slug) => ['c', slug]),
    ...(error ? [['error', error]] : []),
  ]).toString()
  return query ? `/welcome?${query}` : '/welcome'
}

/** Names as a sentence would list them: "Lagos", "Lagos and Abuja", "Lagos, Abuja and Universities". */
export function listOf(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}
