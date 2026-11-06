import type { BirthFields } from '@/app/actions'

/**
 * Day, month and year as numbers, and the tick saying the date is real: on /join
 * and on /birth-date, for members who joined before signup asked (ADR 0020).
 */
export function BirthDateFields({
  birth,
  confirmed,
  dateError,
  confirmError,
}: {
  birth?: BirthFields
  confirmed?: boolean
  dateError?: string
  confirmError?: string
}) {
  const dateInvalid = Boolean(dateError) || undefined
  const field = `field min-h-12 ${dateError ? 'border-danger' : ''}`
  return (
    <>
      <fieldset className="join-dob" aria-describedby={dateError ? 'join-dob-error' : 'join-dob-hint'}>
        <legend className="field-label">Date of birth</legend>
        <div className="join-dob-fields">
          <div>
            <label htmlFor="join-dob-day">Day</label>
            <input
              id="join-dob-day"
              name="day"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={2}
              required
              autoComplete="bday-day"
              defaultValue={birth?.day}
              aria-invalid={dateInvalid}
              className={field}
            />
          </div>
          <div>
            <label htmlFor="join-dob-month">Month</label>
            <input
              id="join-dob-month"
              name="month"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={2}
              required
              autoComplete="bday-month"
              defaultValue={birth?.month}
              aria-invalid={dateInvalid}
              className={field}
            />
          </div>
          <div>
            <label htmlFor="join-dob-year">Year</label>
            <input
              id="join-dob-year"
              name="year"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{4}"
              minLength={4}
              maxLength={4}
              required
              autoComplete="bday-year"
              defaultValue={birth?.year}
              aria-invalid={dateInvalid}
              className={field}
            />
          </div>
        </div>
        {dateError ? (
          <p id="join-dob-error" role="alert" className="text-sm leading-relaxed text-danger">{dateError}</p>
        ) : (
          <p id="join-dob-hint" className="field-hint">
            For example, 27 3 2004. Only you can see it, in Settings. It is never shown on your profile.
          </p>
        )}
      </fieldset>
      <div className="flex flex-col gap-2">
        <label className="join-age">
          <input
            type="checkbox"
            name="confirm"
            value="yes"
            required
            defaultChecked={confirmed}
            aria-invalid={Boolean(confirmError) || undefined}
            aria-describedby={confirmError ? 'join-confirm-error' : undefined}
          />
          <span>This is my real date of birth</span>
        </label>
        {confirmError ? (
          <p id="join-confirm-error" role="alert" className="text-sm leading-relaxed text-danger">{confirmError}</p>
        ) : null}
      </div>
    </>
  )
}
