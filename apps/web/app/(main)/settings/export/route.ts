import { NextResponse } from 'next/server'
import { api } from '@/lib/api'

/**
 * "Download your data": the member's own export from the API, handed to the
 * browser as a file. A plain link, so it works without JavaScript.
 */
export async function GET() {
  const res = await api('/v1/me/export', { cache: 'no-store' })
  if (res.status === 401) return seeOther('/login')
  if (res.status === 429) return seeOther('/settings?export=busy')
  if (!res.ok) return seeOther('/settings?export=failed')

  const data = (await res.json()) as { account?: { handle?: string } }
  const day = new Date().toISOString().slice(0, 10)
  const name = `heynaija-${data.account?.handle ?? 'data'}-${day}.json`
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
    },
  })
}

// Relative, so the redirect stays on the origin the browser used.
const seeOther = (path: string) => new NextResponse(null, { status: 303, headers: { location: path } })
