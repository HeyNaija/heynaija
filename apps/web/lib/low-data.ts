/** How much media a reader wants: follow the browser, always save data, or always load everything. */
export const DATA_MODES = ['auto', 'saver', 'full'] as const
export type DataMode = (typeof DATA_MODES)[number]

/**
 * Remembered in a cookie, as the home feed tab is: the server must know it to leave
 * images out of the page, signed-out readers have no account to keep it on, and a
 * form can set it without JavaScript. It stays in their browser, for a year.
 */
export const DATA_COOKIE = 'hn_data'
export const DATA_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export const dataMode = (stored: string | undefined): DataMode =>
  DATA_MODES.includes(stored as DataMode) ? (stored as DataMode) : 'auto'

/**
 * Whether to hold media back. A reader's own choice wins; only "auto" follows the
 * browser's `Save-Data: on` request header.
 */
export function dataSaver(mode: DataMode, saveDataHeader: string | null): boolean {
  if (mode === 'saver') return true
  if (mode === 'full') return false
  return saveDataHeader?.trim().toLowerCase() === 'on'
}
