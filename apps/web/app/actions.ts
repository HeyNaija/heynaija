'use server'

import { refresh } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  cancelAnswer,
  DELETION_COOKIE,
  DELETION_REAUTHED_PATH,
  DELETION_SCHEDULED_PATH,
  deletionAnswer,
  type Refusal,
  refusalPath,
} from '@/lib/account-deletion'
import { api } from '@/lib/api'
import { AGE_COOKIE, AGE_COOKIE_VALUE, INVITE_COOKIE } from '@/lib/invite'
import { forgetEndedSession, reauthUrl, startAuthUrl } from '@/lib/auth/server'
import { siteOrigin } from '@/lib/previews'
import { preferencesFromForm } from '@/lib/notification-preferences'
import { PUSH_COOKIE } from '@/lib/push'
import { choicesFromForm, welcomePath } from '@/lib/onboarding'
import type { ThreadRow } from '@/lib/thread-state'
import { POLL_OPTIONS_MAX } from '@/lib/polls'
import { POST_MAX } from '@/lib/post-length'
import { isReplyAudience } from '@/lib/reply-audience'
import type { VideoRendition } from '@/lib/video'

// The API is the authority on who is signed in and what they may do; these
// functions only relay the visitor's own session cookie to it.

export type ComposeState = {
  error?: string
  postedAt?: number
  postId?: string
  reply?: { parentId: string; row: ThreadRow }
}

export async function createPost(_prev: ComposeState, formData: FormData, refreshPage = true): Promise<ComposeState> {
  const text = String(formData.get('text') ?? '')
  const replyTo = String(formData.get('replyTo') ?? '') || undefined
  const community = String(formData.get('community') ?? '') || undefined
  const quote = String(formData.get('quote') ?? '') || undefined
  const replyAudience = String(formData.get('replyAudience') ?? 'everyone')
  const poll = formData.get('poll') === '1'
    ? {
        multiple: formData.get('pollMultiple') === '1',
        options: formData.getAll('pollOption').map(String).map((option) => option.trim()).filter(Boolean),
        expiresIn: String(formData.get('pollExpiry') ?? '7_days'),
      }
    : undefined
  // Each attached image is an `image` field naming the upload, with its description in `alt-<id>`.
  const images = formData
    .getAll('image')
    .map(String)
    .filter(Boolean)
    .map((id) => ({ id, alt: String(formData.get(`alt-${id}`) ?? '') }))
  // One video, named by its upload, with its description in `videoDescription`.
  const videoId = String(formData.get('video') ?? '')
  const video = videoId ? { id: videoId, description: String(formData.get('videoDescription') ?? '') } : undefined
  const res = await api('/v1/posts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, replyTo, community, images, video, quote, poll, replyAudience }),
  }).catch(() => null)

  if (!res) return { error: 'Could not post. Check your connection and try again.' }

  if (res.status === 401) redirect('/login')
  if (res.status === 429) return { error: 'You are posting very fast. Wait a minute and try again.' }
  if (res.status === 403) {
    // The session itself can be refused with a 403 too (a suspension, say).
    const body = (await res.json().catch(() => ({}))) as { code?: string }
    if (body.code === 'reply_not_allowed') return { error: 'The author has limited who can reply to this conversation.' }
  }
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { code?: string }
    if (body.code === 'parent_gone') return { error: 'The post you are replying to has been deleted.' }
    if (body.code === 'feature_unavailable') return { error: 'That is not available right now.' }
    if (body.code === 'quote_gone') return { error: 'The post you are quoting is no longer available.' }
    if (body.code === 'not_a_member') return { error: 'Join that community to post in it.' }
    if (body.code === 'community_gone') return { error: 'That community is no longer available.' }
    if (body.code === 'images_not_ready') {
      return { error: 'One of your images is no longer available. Remove it and add it again.' }
    }
    if (body.code === 'video_not_ready') return { error: 'Your video is no longer available. Remove it and add it again.' }
    if (video && !text.trim()) return { error: 'Could not post that video. Try again.' }
    if (poll) return { error: `Check the poll question and its choices. Use 2 to ${POLL_OPTIONS_MAX} different options.` }
    if (text.trim()) return { error: `That post is too long, or an image description is. The post limit is ${POST_MAX.toLocaleString('en-NG')} characters.` }
    return { error: images.length ? 'Could not post those images. Try again.' : 'Write something first.' }
  }
  if (!res.ok) return { error: 'Could not post. Check your connection and try again.' }

  const result = await res.json() as { id: string }
  if (refreshPage) refresh()
  return { postedAt: Date.now(), postId: result.id }
}

/** Posts a quote post, then opens it, so the member sees it with the post it quotes. */
export async function createQuote(prev: ComposeState, formData: FormData): Promise<ComposeState> {
  const state = await createPost(prev, formData, false)
  if (state.postId) redirect(`/p/${encodeURIComponent(state.postId)}`)
  return state
}

/** `upTo` is the newest notification the member has seen. */
export async function markNotificationsRead(upTo: string): Promise<void> {
  await api('/v1/notifications/read', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ upTo }),
  })
}

export async function deletePost(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const res = await api(`/v1/posts/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (res.status === 401) redirect('/login')
  refresh()
}

/** `on` is the state the member wants, so a double submit cannot flip it back. */
export async function setLike(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const method = formData.get('on') === '1' ? 'PUT' : 'DELETE'
  const res = await api(`/v1/posts/${encodeURIComponent(id)}/like`, { method })
  if (res.status === 401) redirect('/login')
  refresh()
}

/**
 * The same as setLike, for the like button when JavaScript runs: it already shows
 * the change, so the page is not re-rendered. On a long feed that re-render would
 * resend every post the reader has loaded.
 */
export async function toggleLike(id: string, on: boolean): Promise<{ ok: boolean }> {
  if (typeof id !== 'string' || id.length > 64) return { ok: false }
  const res = await api(`/v1/posts/${encodeURIComponent(id)}/like`, { method: on ? 'PUT' : 'DELETE' })
  if (res.status === 401) redirect('/login')
  return { ok: res.ok }
}

/** The no-JavaScript repost form. `on` is the state the member wants, as for likes. */
export async function setRepost(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const method = formData.get('on') === '1' ? 'PUT' : 'DELETE'
  const res = await api(`/v1/posts/${encodeURIComponent(id)}/repost`, { method })
  if (res.status === 401) redirect('/login')
  refresh()
}

/** The repost control when JavaScript runs: it already shows the change, as toggleLike does. */
export async function toggleRepost(id: string, on: boolean): Promise<{ ok: boolean }> {
  if (typeof id !== 'string' || id.length > 64) return { ok: false }
  const res = await api(`/v1/posts/${encodeURIComponent(id)}/repost`, { method: on ? 'PUT' : 'DELETE' })
  if (res.status === 401) redirect('/login')
  return { ok: res.ok }
}

export async function setBookmark(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const method = formData.get('on') === '1' ? 'PUT' : 'DELETE'
  const res = await api(`/v1/posts/${encodeURIComponent(id)}/bookmark`, { method })
  if (res.status === 401) redirect('/login')
  refresh()
}

/** Pins one of your own posts to the top of your profile, or unpins it. */
export async function setProfilePin(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const method = formData.get('on') === '1' ? 'PUT' : 'DELETE'
  const res = await api(`/v1/posts/${encodeURIComponent(id)}/pin`, { method })
  if (res.status === 401) redirect('/login')
  refresh()
}

/** Pins a post to the top of its community, or unpins it. The API checks the visitor moderates it. */
export async function setCommunityPin(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const method = formData.get('on') === '1' ? 'PUT' : 'DELETE'
  const res = await api(`/v1/posts/${encodeURIComponent(id)}/community-pin`, { method })
  if (res.status === 401) redirect('/login')
  refresh()
}

export async function setReplyAudience(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const audience = String(formData.get('audience') ?? '')
  if (!isReplyAudience(audience)) return
  const res = await api(`/v1/posts/${encodeURIComponent(id)}/reply-audience`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audience }),
  })
  if (res.status === 401) redirect('/login')
  refresh()
}

export type PollVoteState = { error?: string; done?: boolean }

export async function castPollVote(_previous: PollVoteState, formData: FormData): Promise<PollVoteState> {
  const id = String(formData.get('id') ?? '')
  const optionIds = formData.getAll('option').map(String)
  const res = await api(`/v1/posts/${encodeURIComponent(id)}/poll/vote`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ optionIds }),
  }).catch(() => null)
  if (!res) return { error: 'Could not record your vote. Check your connection and try again.' }
  if (res.status === 401) redirect('/login')
  if (res.status === 429) return { error: 'You are voting very fast. Wait a moment and try again.' }
  if (res.status === 404) return { error: 'This poll is no longer available.' }
  if (res.status === 400) {
    const body = await res.json().catch(() => ({})) as { code?: string }
    if (body.code === 'poll_closed') return { error: 'This poll has ended.' }
    if (body.code === 'poll_already_voted') return { error: 'Your vote has already been recorded.' }
    return { error: 'Choose a valid poll option and try again.' }
  }
  if (!res.ok) return { error: 'Could not record your vote. Try again in a moment.' }
  refresh()
  return { done: true }
}

export async function setMembership(formData: FormData): Promise<void> {
  const slug = String(formData.get('slug') ?? '')
  const method = formData.get('on') === '1' ? 'PUT' : 'DELETE'
  const res = await api(`/v1/communities/${encodeURIComponent(slug)}/membership`, { method })
  if (res.status === 401) redirect('/login')
  refresh()
}

/** PUT or DELETE a simple on/off relationship with another member. */
async function setRelation(formData: FormData, relation: 'block' | 'mute'): Promise<void> {
  const handle = String(formData.get('handle') ?? '')
  const method = formData.get('on') === '1' ? 'PUT' : 'DELETE'
  const res = await api(`/v1/members/${encodeURIComponent(handle)}/${relation}`, { method })
  if (res.status === 401) redirect('/login')
  refresh()
}

export async function setBlock(formData: FormData): Promise<void> {
  return setRelation(formData, 'block')
}

export async function setMute(formData: FormData): Promise<void> {
  return setRelation(formData, 'mute')
}

export type FormState = { error?: string; done?: boolean }

export async function updateProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const res = await api('/v1/me/profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      displayName: String(formData.get('displayName') ?? ''),
      bio: String(formData.get('bio') ?? ''),
    }),
  })
  if (res.status === 401) redirect('/login')
  if (res.status === 429) return { error: 'You have changed your profile a lot. Try again in an hour.' }
  if (res.status === 400) return { error: 'Keep your name to 50 characters and your bio to 160.' }
  if (!res.ok) return { error: 'Could not save. Try again in a moment.' }
  refresh()
  return { done: true }
}

/** Saves every box in the Settings form at once: ticked kinds on, the rest off. */
export async function updateNotificationPreferences(_prev: FormState, formData: FormData): Promise<FormState> {
  const res = await api('/v1/notifications/preferences', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(preferencesFromForm(formData)),
  }).catch(() => null)
  if (!res) return { error: 'Could not save. Check your connection and try again.' }
  if (res.status === 401) redirect('/login')
  if (res.status === 429) return { error: 'You are changing settings very fast. Wait a minute and try again.' }
  if (!res.ok) return { error: 'Could not save. Try again in a moment.' }
  refresh()
  return { done: true }
}

// --- Push notifications: the browser subscribes with its push service, then tells the API. ---

/** What `PushSubscription.toJSON()` gives, which is what the API takes. */
export type PushSubscriptionJson = { endpoint: string; keys: { p256dh: string; auth: string } }

export async function subscribeToPush(subscription: PushSubscriptionJson): Promise<{ error?: string }> {
  const res = await api('/v1/push/subscriptions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(subscription),
  }).catch(() => null)
  if (!res) return { error: 'Could not turn on push notifications. Check your connection and try again.' }
  if (res.status === 401) redirect('/login')
  if (res.status === 429) return { error: 'You are changing settings very fast. Wait a minute and try again.' }
  if (res.status === 400) return { error: 'HeyNaija cannot send push notifications to this browser.' }
  if (!res.ok) return { error: 'Could not turn on push notifications. Try again in a moment.' }
  const { id } = (await res.json()) as { id: string }
  // Read by /logout, which stops this browser's pushes when its member signs out.
  ;(await cookies()).set(PUSH_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 400 * 24 * 60 * 60,
  })
  return {}
}

export async function unsubscribeFromPush(endpoint: string): Promise<{ error?: string }> {
  const res = await api('/v1/push/subscriptions/remove', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  }).catch(() => null)
  if (!res) return { error: 'Could not turn off push notifications. Check your connection and try again.' }
  if (res.status === 401) redirect('/login')
  if (res.status === 429) return { error: 'You are changing settings very fast. Wait a minute and try again.' }
  // 400: not a push service's address, so nothing was ever sent to it.
  if (!res.ok && res.status !== 400) return { error: 'Could not turn off push notifications. Try again in a moment.' }
  ;(await cookies()).delete(PUSH_COOKIE)
  return {}
}

/**
 * Whether the signed-in member's notifications are pushed to the browser with
 * this address. If another member's are, the API stops them. Treated as "no"
 * when the API cannot be asked.
 */
export async function checkPushSubscription(endpoint: string): Promise<{ subscribed: boolean }> {
  const res = await api('/v1/push/subscriptions/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  }).catch(() => null)
  if (!res?.ok) return { subscribed: false }
  return res.json()
}

// --- Profile photo: the browser uploads straight to storage between these two calls. ---

export type UploadTicket = { mediaId: string; uploadUrl: string } | { error: string }

/**
 * Step 1 of a square photo (a profile or community photo): the upload ticket, or
 * what to tell the member. `forbidden` is said on a 403, for the community's.
 */
async function startSquarePhoto(path: string, contentType: string, bytes: number, say: { tooMany: string; forbidden?: string }): Promise<UploadTicket> {
  const res = await api(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contentType, bytes }),
  })
  if (res.status === 401) redirect('/login')
  if (res.status === 403 && say.forbidden) return { error: say.forbidden }
  if (res.status === 429) return { error: say.tooMany }
  if (res.status === 400) return { error: 'Choose a JPEG, PNG or WebP image under 5 MB.' }
  if (!res.ok) return { error: 'Could not start the upload. Try again in a moment.' }
  return res.json()
}

/** Step 2 of a square photo: published, or what to tell the member. */
async function finishSquarePhoto(path: string, say: { failed: string; forbidden?: string }): Promise<{ error?: string }> {
  const res = await api(path, { method: 'POST' })
  if (res.status === 401) redirect('/login')
  if (res.status === 403 && say.forbidden) return { error: say.forbidden }
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { code?: string }
    const messages: Record<string, string> = {
      not_an_image: 'That file is not a JPEG, PNG or WebP image.',
      too_large: 'That image is too large. The limit is 5 MB.',
      blocked: 'That image cannot be used.',
    }
    return { error: messages[body.code ?? ''] ?? 'The upload did not finish. Try again.' }
  }
  if (res.status === 503) return { error: 'Images cannot be checked right now. Try again in a few minutes.' }
  if (!res.ok) return { error: say.failed }
  refresh()
  return {}
}

export async function startAvatarUpload(contentType: string, bytes: number): Promise<UploadTicket> {
  return startSquarePhoto('/v1/me/avatar/upload', contentType, bytes, { tooMany: 'You have changed your photo a lot. Try again in an hour.' })
}

export async function finishAvatarUpload(mediaId: string): Promise<{ error?: string }> {
  return finishSquarePhoto(`/v1/me/avatar/${encodeURIComponent(mediaId)}/complete`, { failed: 'Could not save your photo. Try again in a moment.' })
}

// --- Post images: same two steps, then the browser waits for the background job. ---

export type ImageStatus = 'pending' | 'processing' | 'ready' | 'failed'

export async function startPostImageUpload(contentType: string, bytes: number): Promise<UploadTicket> {
  const res = await api('/v1/me/images/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contentType, bytes }),
  })
  if (res.status === 401) redirect('/login')
  if (res.status === 429) return { error: 'You have added a lot of images. Wait a few minutes and try again.' }
  if (res.status === 400) return { error: 'Choose a JPEG, PNG, WebP or GIF under 10 MB.' }
  if (!res.ok) return { error: 'Could not start the upload. Try again in a moment.' }
  return res.json()
}

export async function finishPostImageUpload(mediaId: string): Promise<{ status: ImageStatus } | { error: string }> {
  const res = await api(`/v1/me/images/${encodeURIComponent(mediaId)}/complete`, { method: 'POST' })
  if (res.status === 401) redirect('/login')
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { code?: string }
    return { error: body.code === 'too_large' ? 'That image is too large. The limit is 10 MB.' : 'The upload did not finish. Try again.' }
  }
  if (!res.ok) return { error: 'Could not save that image. Try again in a moment.' }
  return res.json()
}

/** Null when the upload is gone (abandoned, or never this member's). Throws on other failures. */
export async function postImageStatus(mediaId: string): Promise<ImageStatus | null> {
  const res = await api(`/v1/me/images/${encodeURIComponent(mediaId)}`)
  if (res.status === 401) redirect('/login')
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`API image status responded ${res.status}`)
  return ((await res.json()) as { status: ImageStatus }).status
}

// --- Post video (docs/adr/0019): parts go straight to storage, then the browser waits for the worker. ---

export type VideoPlan = {
  mediaId: string
  partSize: number
  totalParts: number
  done: { partNumber: number; size: number }[]
  parts: { partNumber: number; url: string; bytes: number }[]
}
export type VideoState = 'uploading' | 'processing' | 'quarantined' | 'ready' | 'rejected' | 'failed'
export type VideoStatus = {
  status: VideoState
  reason: 'too_long' | 'too_short' | 'too_large' | 'too_big_picture' | 'not_a_video' | null
  video: { id: string; src: string; durationMs: number; width: number; height: number; description: string; renditions: VideoRendition[] } | null
}

const VIDEO_REFUSALS: Record<string, string> = {
  too_large: 'That video is too large. The limit is 100 MB.',
  too_long: 'That video is too long. The limit is 60 seconds.',
  bad_type: 'Choose an MP4, MOV or WebM video.',
  too_many_videos: 'You have the most videos allowed. Delete a post with a video first.',
  not_eligible: 'Video is not available to your account yet.',
  bad_parts: 'The upload did not finish. Try again.',
}

async function refusal(res: Response): Promise<{ error: string }> {
  if (res.status === 401) redirect('/login')
  if (res.status === 404) return { error: 'Video is not available right now.' }
  if (res.status === 429) return { error: 'You have started a lot of videos. Wait a while and try again.' }
  const body = (await res.json().catch(() => ({}))) as { code?: string }
  return { error: VIDEO_REFUSALS[body.code ?? ''] ?? 'Could not upload that video. Try again in a moment.' }
}

export async function startVideoUpload(contentType: string, bytes: number, durationMs?: number): Promise<VideoPlan | { error: string }> {
  const res = await api('/v1/me/videos/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contentType, bytes, ...(durationMs === undefined ? {} : { durationMs: Math.round(durationMs) }) }),
  }).catch(() => null)
  if (!res) return { error: 'Could not start the upload. Check your connection and try again.' }
  return res.ok ? res.json() : refusal(res)
}

/** After a lost connection: which parts storage already holds, and fresh addresses for the rest. */
export async function resumeVideoUpload(mediaId: string): Promise<VideoPlan | { error: string }> {
  const res = await api(`/v1/me/videos/${encodeURIComponent(mediaId)}/upload`).catch(() => null)
  if (!res) return { error: 'Could not reach the server. Check your connection and try again.' }
  return res.ok ? res.json() : refusal(res)
}

export async function completeVideoUpload(mediaId: string): Promise<VideoStatus | { error: string }> {
  const res = await api(`/v1/me/videos/${encodeURIComponent(mediaId)}/complete`, { method: 'POST' }).catch(() => null)
  if (!res) return { error: 'Could not finish the upload. Check your connection and try again.' }
  return res.ok ? res.json() : refusal(res)
}

/** Null when the video is gone (abandoned, or never this member's). Throws on other failures. */
export async function videoStatus(mediaId: string): Promise<VideoStatus | null> {
  const res = await api(`/v1/me/videos/${encodeURIComponent(mediaId)}`)
  if (res.status === 401) redirect('/login')
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`API video status responded ${res.status}`)
  return res.json()
}

export async function removeVideo(mediaId: string): Promise<void> {
  await api(`/v1/me/videos/${encodeURIComponent(mediaId)}`, { method: 'DELETE' }).catch(() => null)
}

export async function removeAvatar(): Promise<void> {
  const res = await api('/v1/me/avatar', { method: 'DELETE' })
  if (res.status === 401) redirect('/login')
  refresh()
}

// --- Community photo: the same steps, for the community's moderators. ---

const photoPath = (slug: string) => `/v1/communities/${encodeURIComponent(slug)}/photo`

const notAModerator = 'Only the moderators of this community can change its photo.'

export async function startCommunityPhotoUpload(slug: string, contentType: string, bytes: number): Promise<UploadTicket> {
  return startSquarePhoto(`${photoPath(slug)}/upload`, contentType, bytes, {
    tooMany: 'You have changed photos a lot. Try again in an hour.',
    forbidden: notAModerator,
  })
}

export async function finishCommunityPhotoUpload(slug: string, mediaId: string): Promise<{ error?: string }> {
  return finishSquarePhoto(`${photoPath(slug)}/${encodeURIComponent(mediaId)}/complete`, {
    failed: 'Could not save the photo. Try again in a moment.',
    forbidden: notAModerator,
  })
}

/** `takeDown` is a site moderator's logged decision; otherwise the photo is simply deleted. */
export async function removeCommunityPhoto(slug: string, takeDown = false): Promise<{ error?: string }> {
  const res = takeDown
    ? await api(`/v1/moderation/communities/${encodeURIComponent(slug)}/photo/remove`, { method: 'POST' })
    : await api(photoPath(slug), { method: 'DELETE' })
  if (res.status === 401) redirect('/login')
  if (res.status === 403) return { error: notAModerator }
  if (!res.ok && res.status !== 400) return { error: 'Could not remove the photo. Try again in a moment.' }
  refresh()
  return {}
}

export async function submitReport(_prev: FormState, formData: FormData): Promise<FormState> {
  const postId = String(formData.get('postId') ?? '') || undefined
  const handle = String(formData.get('handle') ?? '') || undefined
  const communitySlug = String(formData.get('community') ?? '') || undefined
  const res = await api('/v1/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(postId ? { postId } : communitySlug ? { communitySlug } : { handle }),
      reason: String(formData.get('reason') ?? ''),
      details: String(formData.get('details') ?? ''),
    }),
  })
  if (res.status === 401) redirect('/login')
  if (res.status === 429) return { error: 'You have sent a lot of reports. Please try again later.' }
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    return { error: typeof body.message === 'string' && body.message.length < 80 ? `Could not send: ${body.message}.` : 'Choose a reason and try again.' }
  }
  if (!res.ok) return { error: 'Could not send the report. Try again in a moment.' }
  return { done: true }
}

export async function submitAppeal(_prev: FormState, formData: FormData): Promise<FormState> {
  const message = String(formData.get('message') ?? '')
  const res = await api('/v1/appeals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  if (res.status === 400) return { error: 'Tell us a little more (at least 10 characters).' }
  if (!res.ok) return { error: 'Could not send your appeal. Try again in a moment.' }
  return { done: true }
}

export async function resolveReport(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const res = await api(`/v1/moderation/reports/${encodeURIComponent(id)}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // The button that was pressed names the decision.
    body: JSON.stringify({ resolution: String(formData.get('resolution') ?? ''), note: String(formData.get('note') ?? '') }),
  })
  if (res.status === 401) redirect('/login')
  refresh()
}

/** A site moderator turns a feature on or off, or limits it to some members (docs/feature-flags.md). */
export async function setFlag(_prev: FormState, formData: FormData): Promise<FormState> {
  const key = String(formData.get('key') ?? '')
  const mode = String(formData.get('mode') ?? 'default')
  const handles = String(formData.get('handles') ?? '')
    .split(/[\s,]+/)
    .map((h) => h.replace(/^@/, '').trim().toLowerCase())
    .filter(Boolean)
  if (mode === 'list' && handles.length === 0) return { error: 'Name at least one member, or choose another setting.' }
  const enabled = mode === 'on' ? true : mode === 'off' ? false : null
  const res = await api(`/v1/admin/flags/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled, handles: mode === 'list' ? handles : [] }),
  })
  if (res.status === 401) redirect('/login')
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    return { error: typeof body.message === 'string' && body.message.length < 160 ? body.message : 'Check the handles.' }
  }
  if (!res.ok) return { error: 'Could not change that. Try again in a moment.' }
  refresh()
  return { done: true }
}

/** A site moderator makes someone a community moderator, or stops them being one. */
export async function setCommunityModerator(_prev: FormState, formData: FormData): Promise<FormState> {
  const slug = String(formData.get('community') ?? '')
  const handle = String(formData.get('handle') ?? '').trim().replace(/^@/, '').toLowerCase()
  const on = formData.get('on') === '1'
  const res = await api(`/v1/moderation/communities/${encodeURIComponent(slug)}/moderators/${encodeURIComponent(handle)}`, {
    method: on ? 'PUT' : 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ note: String(formData.get('note') ?? '') }),
  })
  if (res.status === 401) redirect('/login')
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    const message = typeof body.message === 'string' && body.message.length < 120 ? body.message : 'check the handle'
    return { error: `Could not change that: ${message}.` }
  }
  if (!res.ok) return { error: 'Could not change that. Try again in a moment.' }
  refresh()
  return { done: true }
}

export async function restorePost(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  await api(`/v1/moderation/posts/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  refresh()
}

export async function setFollow(formData: FormData): Promise<void> {
  const handle = String(formData.get('handle') ?? '')
  const method = formData.get('on') === '1' ? 'PUT' : 'DELETE'
  const res = await api(`/v1/members/${encodeURIComponent(handle)}/follow`, { method })
  if (res.status === 401) redirect('/login')
  refresh()
}

// --- The welcome flow (/welcome). Plain forms, so they work before JavaScript loads. ---

/**
 * Step 2's form: joins the communities chosen in step 1 and follows the people
 * ticked in step 2, all at once, which finishes setup. Then comes the offer of
 * notifications, and after it the Following feed with a nudge to post. "Skip this
 * step" still joins the communities.
 */
export async function finishOnboarding(formData: FormData): Promise<void> {
  const choices = choicesFromForm(formData)
  const res = await api('/v1/me/onboarding/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(choices),
  }).catch(() => null)
  if (res?.status === 401) redirect('/login')
  if (!res?.ok) redirect(welcomePath('people', choices.communities, res?.status === 429 ? 'busy' : 'failed'))
  // The side rail, in the shared layout, lists communities with Join buttons.
  refresh()
  redirect(welcomePath('notifications', []))
}

/** Leaves the welcome flow without joining or following anyone. It is not shown again. */
export async function skipOnboarding(): Promise<void> {
  const res = await api('/v1/me/onboarding/skip', { method: 'POST' }).catch(() => null)
  if (res?.status === 401) redirect('/login')
  if (!res?.ok) redirect(welcomePath('communities', [], res?.status === 429 ? 'busy' : 'failed'))
  redirect('/')
}

export type JoinState = { error?: string; ageError?: string; code?: string; adult?: boolean; next?: string }

export async function acceptInvite(_prev: JoinState, formData: FormData): Promise<JoinState> {
  const typed = String(formData.get('code') ?? '').slice(0, 40)
  // Letters and digits only: this value goes into a cookie that Kratos reads raw.
  const code = typed.toUpperCase().replace(/[^0-9A-Z]/g, '')
  // Accounts are 18+ during the beta (a temporary rule). The API's registration
  // webhook checks this again.
  const adult = formData.get('adult') === 'yes'
  if (!adult) {
    return { code: typed, adult, ageError: 'During the beta, HeyNaija is open to people aged 18 or older. Confirm your age to continue.' }
  }

  const res = await api('/v1/invites/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!res.ok) return { code: typed, adult, error: 'Could not check that code. Try again in a moment.' }
  if (!((await res.json()) as { usable: boolean }).usable) {
    return { code: typed, adult, error: 'That code is not valid. Check it, or ask whoever invited you for a new one.' }
  }

  const jar = await cookies()
  const options = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60,
  } as const
  jar.set(INVITE_COOKIE, code, options)
  jar.set(AGE_COOKIE, AGE_COOKIE_VALUE, options)
  // Not redirect(): for a server action Next renders the redirect target on the
  // server, so Kratos's anti-CSRF cookie never reaches the browser and /signup is
  // rendered without the invite cookie, which sends the visitor back to /join.
  // The form navigates the browser itself instead.
  return { next: startAuthUrl('registration') }
}

/**
 * What the account deletion form shows: an error, or Kratos's sign-in to confirm
 * it is them (`next`), which the form opens itself and, if that fails, offers
 * as a link. Not redirect(), as in acceptInvite: Kratos must set its cookies in
 * the browser itself. (Without JavaScript there is no form state to draw, so
 * requestAccountDeletion redirects instead: see there.)
 */
export type DeletionFormState = { error?: string; next?: { href: string; label: string } }

/**
 * Asks for the member's account to be deleted (docs/adr/0016), then lands on a
 * page with the date. The API ends every session, this one too, and Kratos's
 * logout (and so /logout) refuses a session that has ended, so this browser just
 * forgets its cookie. Its push subscription goes too: nothing is pushed to an
 * account waiting for deletion, and the erase deletes the subscriptions.
 *
 * The form says whether JavaScript runs (`js`). With it, a refusal or the sign-in
 * step is returned for the form to draw. Without it a production build cannot
 * draw form state into the prerendered page, so a refusal redirects to its page
 * (refusalPath) and the sign-in step to Kratos, a plain redirect the browser
 * follows with Kratos's cookies.
 */
export async function requestAccountDeletion(_prev: DeletionFormState, formData: FormData): Promise<DeletionFormState> {
  const viaScript = formData.get('js') === '1'
  const refuse = (refusal: Refusal, message: string): DeletionFormState =>
    viaScript ? { error: message } : redirect(refusalPath(refusal))
  const res = await api('/v1/me/deletion', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmHandle: String(formData.get('confirmHandle') ?? '') }),
    cache: 'no-store',
  }).catch(() => null)
  if (!res) return refuse('unavailable', 'Your account could not be deleted just now. Check your connection and try again.')

  const answer = deletionAnswer(res.status, await res.json().catch(() => ({})))
  if (answer.kind === 'signed_out') redirect('/login')
  if (answer.kind === 'error') return refuse(answer.refusal, answer.message)
  if (answer.kind === 'reauth') {
    const href = reauthUrl(new URL(DELETION_REAUTHED_PATH, siteOrigin).href)
    return viaScript ? { next: { href, label: 'Sign in again' } } : redirect(href)
  }

  await forgetEndedSession()
  const jar = await cookies()
  jar.delete(PUSH_COOKIE)
  jar.set(DELETION_COOKIE, answer.scheduledFor, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: DELETION_SCHEDULED_PATH,
    maxAge: 60 * 60,
  })
  redirect(DELETION_SCHEDULED_PATH)
}

/**
 * Calls off the deletion of a member who signed in again during the grace period.
 * The page is drawn again, as the member it is now: home shows the feed.
 */
export async function cancelAccountDeletion(_prev: FormState, _formData: FormData): Promise<FormState> {
  const res = await api('/v1/me/deletion', { method: 'DELETE', cache: 'no-store' }).catch(() => null)
  if (!res) return { error: 'The deletion could not be cancelled just now. Check your connection and try again.' }
  const answer = cancelAnswer(res.status, await res.json().catch(() => ({})))
  if (answer?.kind === 'signed_out') redirect('/login')
  if (answer) return { error: answer.message }
  refresh()
  return { done: true }
}
