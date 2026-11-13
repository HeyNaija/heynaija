import { appleAppSiteAssociation } from '@/lib/app-links'

/**
 * Which links to this site open in the iOS app (lib/app-links.ts). The same on
 * every server, so it is made when the site is built. Apple's CDN fetches it, at
 * this exact path with no redirect, and must be given JSON.
 */
export function GET() {
  return Response.json(appleAppSiteAssociation(), { headers: { 'Cache-Control': 'public, max-age=3600' } })
}
