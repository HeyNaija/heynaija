'use client'

import { useActionState } from 'react'
import { type FormState, updateNotificationPreferences } from '@/app/actions'
import { NOTIFICATION_SETTINGS, type NotificationPreferences } from '@/lib/notification-preferences'

/**
 * One box for email and one per kind of activity. A plain form, so it also works
 * before JavaScript has loaded.
 */
export function NotificationPreferencesForm({ preferences }: { preferences: NotificationPreferences }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateNotificationPreferences, {})

  return (
    <form action={action} className="flex flex-col gap-4">
      <fieldset className="settings-checks">
        <legend className="field-label">Email</legend>
        <label className="settings-check">
          <input type="checkbox" name="email" defaultChecked={preferences.email} aria-describedby="email-hint" />
          <span>Email me my notifications</span>
        </label>
      </fieldset>
      <p id="email-hint" className="field-hint">
        One email with everything new, at most about twice an hour and never for what you have already read in
        HeyNaija, to the address you sign in with. Every email has a link that turns this off.
      </p>

      <fieldset className="settings-checks">
        <legend className="field-label">Notify me when</legend>
        {NOTIFICATION_SETTINGS.map(({ kind, label }) => (
          <label key={kind} className="settings-check">
            {/* Not controlled: React resets the form after each save, and the boxes
                then show what was saved (what the page reloaded with). */}
            <input type="checkbox" name="on" value={kind} defaultChecked={preferences[kind]} />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      <p className="field-hint">
        Changes apply to new activity, in HeyNaija and by email. Safety and moderation notices, about your posts,
        your account and the reports you make, are always sent in HeyNaija, and by email while email is on.
      </p>

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
