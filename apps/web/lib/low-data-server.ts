import { cookies, headers } from 'next/headers'
import { DATA_COOKIE, dataMode, dataSaver } from './low-data'

/** The reader's saved choice, "auto" when they have not made one. */
export async function currentDataMode() {
  return dataMode((await cookies()).get(DATA_COOKIE)?.value)
}

/** Whether this request's media is held back: the reader's choice, else the browser's Save-Data hint. */
export async function currentDataSaver() {
  const mode = await currentDataMode()
  return dataSaver(mode, (await headers()).get('save-data'))
}
