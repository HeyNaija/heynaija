// Sends a Trivia request from the browser and words what went wrong (docs/adr/0028, phase 7).

export type CallResult<T = unknown> = { ok: true; body: T } | { ok: false; status: number; message: string }

export async function triviaCall<T = unknown>(path: string, method: 'GET' | 'POST' | 'PUT' = 'POST', body?: object): Promise<CallResult<T>> {
  const res = await fetch(`/api/v1/games/trivia${path}`, {
    method,
    cache: 'no-store',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null)
  if (!res) return { ok: false, status: 0, message: 'You seem to be offline. Try again.' }
  if (res.ok) return { ok: true, body: (res.status === 204 ? null : await res.json().catch(() => null)) as T }
  const answer = (await res.json().catch(() => null)) as { message?: string | { message?: string } } | null
  const message = typeof answer?.message === 'string' ? answer.message : answer?.message?.message
  if (res.status === 429) return { ok: false, status: 429, message: 'That was a lot at once. Wait a moment and try again.' }
  return { ok: false, status: res.status, message: message ?? 'That did not go through. Try again.' }
}
