import { connection } from 'next/server'
import { assetLinks, certFingerprints } from '@/lib/app-links'

/**
 * That links to this site may open in the Android app (lib/app-links.ts): the
 * app's signing certificates come from the server's ANDROID_CERT_SHA256, so this
 * is read when asked, not when the site is built.
 */
export async function GET() {
  await connection()
  const { valid, invalid } = certFingerprints(process.env.ANDROID_CERT_SHA256)
  if (invalid.length > 0) console.error(`ANDROID_CERT_SHA256: not a SHA-256 fingerprint, left out: ${invalid.join(', ')}`)
  return Response.json(assetLinks(valid), { headers: { 'Cache-Control': 'public, max-age=3600' } })
}
