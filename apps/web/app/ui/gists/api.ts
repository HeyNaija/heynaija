// The browser's calls to the Gists API, through the /api rewrite so the session
// cookie is first-party. There are no server actions here: the room is live, and a
// server action would re-render the page on every tap.

/** `gistId` comes only with `already_hosting`: the caller's own live Gist. */
export type Reply<T> = { ok: true; status: number; data: T } | { ok: false; status: number; code?: string; message?: string; gistId?: string }

export async function gistCall<T = undefined>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<Reply<T>> {
  try {
    const res = await fetch(`/api/v1/gists${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    })
    if (res.ok) return { ok: true, status: res.status, data: (res.status === 204 ? undefined : await res.json()) as T }
    const problem = (await res.json().catch(() => null)) as { code?: string; message?: string; gistId?: unknown } | null
    return {
      ok: false,
      status: res.status,
      code: problem?.code,
      message: typeof problem?.message === 'string' ? problem.message : undefined,
      gistId: typeof problem?.gistId === 'string' ? problem.gistId : undefined,
    }
  } catch {
    // No network at all: status 0, which the room treats as "try again".
    return { ok: false, status: 0 }
  }
}
