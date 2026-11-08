'use client'

import { useActionState } from 'react'
import { type FormState, updateSensitiveSettings } from '@/app/actions'
import type { Me } from '@/lib/api'

/**
 * An adult's choices about posts marked sensitive (ADR 0020): whether their
 * pictures and video show without the cover, and whether everything they post is
 * marked. A plain form, so it also works before JavaScript has loaded.
 */
export function SensitiveSettingsForm({ settings, offerMark }: { settings: Me['sensitive']; offerMark: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateSensitiveSettings, {})
  const byModerator = settings.markPosts === 'moderator'

  return (
    <form action={action} className="flex flex-col gap-4">
      <fieldset className="settings-checks">
        <legend className="field-label">What you see</legend>
        <label className="settings-check">
          <input type="checkbox" name="showMedia" defaultChecked={settings.showMedia} aria-describedby="sensitive-show-hint" />
          <span>Show sensitive pictures and video without a warning</span>
        </label>
      </fieldset>
      <p id="sensitive-show-hint" className="field-hint">
        Off, pictures and video in posts marked sensitive are blurred until you tap Show. The words of a post are
        never hidden from you.
      </p>

      {offerMark || settings.markPosts ? (
        <>
          <fieldset className="settings-checks">
            <legend className="field-label">What you post</legend>
            {offerMark && !byModerator ? <input type="hidden" name="markPostsOffered" value="1" /> : null}
            <label className="settings-check">
              <input
                type="checkbox"
                name="markPosts"
                defaultChecked={settings.markPosts !== null}
                disabled={byModerator}
                aria-describedby="sensitive-mark-hint"
              />
              <span>Mark everything I post as sensitive</span>
            </label>
          </fieldset>
          <p id="sensitive-mark-hint" className="field-hint">
            {byModerator ? (
              <>
                A moderator turned this on because posts of yours needed the mark. Write to{' '}
                <a href="mailto:contact@heynaija.ng" className="font-semibold text-accent-strong hover:underline">
                  contact@heynaija.ng
                </a>{' '}
                if you think it is a mistake.
              </>
            ) : (
              'For people who often post sensitive things. Your new posts are not shown to anyone under 18 or signed out, and their pictures and video are blurred until people choose to see them.'
            )}
          </p>
        </>
      ) : null}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save'}
        </button>
        <p role="status" className="text-sm text-muted empty:hidden">
          {state.done && !pending ? 'Saved.' : ''}
        </p>
      </div>
      <p role="alert" className="text-sm text-danger empty:hidden">
        {state.error}
      </p>
    </form>
  )
}
