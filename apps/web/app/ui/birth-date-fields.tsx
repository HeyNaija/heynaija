'use client'

import { useState } from 'react'
import type { BirthFields } from '@/app/actions'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** How far back the year list goes: the oldest date the API takes (birthDateFrom). */
const OLDEST = 120

/** This year in Lagos, where ages are counted: UTC+1 all year, with no daylight saving. */
const lagosYear = () => new Date(Date.now() + 60 * 60 * 1000).getUTCFullYear()

/** Days in a month (1 to 12) of a year; until both are chosen, as many as it can have. */
function daysIn(month: number, year: number) {
  if (!month) return 31
  // 2000 was a leap year, so February keeps the 29th until the year says otherwise.
  return new Date(Date.UTC(year || 2000, month, 0)).getUTCDate()
}

type Props = {
  birth?: BirthFields
  confirmed?: boolean
  dateError?: string
  confirmError?: string
}

/**
 * Day, month and year chosen from lists, and the tick saying the date is real:
 * on /join and on /birth-date, for members who joined before signup asked (ADR
 * 0020). Lists rather than a calendar, which opens on today and makes a birthday
 * decades back a long way to go; the month by name, so 3/4 cannot be read as
 * 4/3. Whether the date is a real day is still the API's call, for browsers
 * without JavaScript, where the day list is not cut to the month.
 */
export function BirthDateFields(props: Props) {
  // React resets the form after each answer, and a select goes back to the
  // option it was first drawn with, so the fields are drawn again with what was
  // sent; nothing at all when the answer did not send the date back.
  const { birth } = props
  return <Fields key={birth ? `${birth.year}-${birth.month}-${birth.day}` : ''} {...props} />
}

function Fields({ birth, confirmed, dateError, confirmError }: Props) {
  const [month, setMonth] = useState(birth?.month ?? '')
  const [year, setYear] = useState(birth?.year ?? '')
  const latest = lagosYear()
  const days = daysIn(Number(month), Number(year))
  const dateInvalid = Boolean(dateError) || undefined
  const field = `field min-h-12 ${dateError ? 'border-danger' : ''}`
  return (
    <>
      <fieldset className="join-dob" aria-describedby={dateError ? 'join-dob-error' : 'join-dob-hint'}>
        <legend className="field-label">Date of birth</legend>
        <div className="join-dob-fields">
          <div>
            <label htmlFor="join-dob-day">Day</label>
            {/* A day the month no longer has is dropped, so the list goes back to empty. */}
            <select
              id="join-dob-day"
              name="day"
              required
              autoComplete="bday-day"
              defaultValue={birth?.day ?? ''}
              aria-invalid={dateInvalid}
              className={field}
            >
              <option value="" />
              {Array.from({ length: days }, (_, i) => (
                <option key={i + 1} value={String(i + 1)}>
                  {i + 1}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="join-dob-month">Month</label>
            <select
              id="join-dob-month"
              name="month"
              required
              autoComplete="bday-month"
              defaultValue={birth?.month ?? ''}
              onChange={(event) => setMonth(event.target.value)}
              aria-invalid={dateInvalid}
              className={field}
            >
              <option value="" />
              {MONTHS.map((name, i) => (
                <option key={name} value={String(i + 1)}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="join-dob-year">Year</label>
            <select
              id="join-dob-year"
              name="year"
              required
              autoComplete="bday-year"
              defaultValue={birth?.year ?? ''}
              onChange={(event) => setYear(event.target.value)}
              aria-invalid={dateInvalid}
              className={field}
            >
              <option value="" />
              {Array.from({ length: OLDEST + 1 }, (_, i) => latest - i).map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>
        {dateError ? (
          <p id="join-dob-error" role="alert" className="text-sm leading-relaxed text-danger">{dateError}</p>
        ) : (
          <p id="join-dob-hint" className="field-hint">
            Only you can see it, in Settings. It is never shown on your profile.
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
