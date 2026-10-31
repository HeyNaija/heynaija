import { getViewer } from '@/lib/api'
import { IncomingCall } from './incoming-call'

/**
 * Mounts the incoming-call alert for members who have calls. With `features.calls`
 * false (the flag off, or not on the list) this renders nothing at all, so no
 * client code, no polling and no element exists.
 */
export async function CallsHost() {
  const viewer = await getViewer()
  if (viewer.state !== 'member' || !viewer.me.features.calls) return null
  return <IncomingCall />
}
