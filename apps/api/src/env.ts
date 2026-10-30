import { z } from 'zod'

/**
 * A switch for work that is not allowed to run yet. It must be absent or
 * "false": the API refuses to start with it set to "true", so a stray variable on
 * a server cannot switch on identity checks, binding votes or under-18 accounts
 * before the approvals listed in docs/governance/open-items.md exist. Turning
 * one on means building the feature and changing this line, in review.
 */
const lockedOff = (name: string) =>
  z
    .enum(['false', 'true'])
    .default('false')
    .transform((value) => value === 'true')
    .refine((on) => !on, { error: `${name} cannot be enabled yet; see docs/governance/open-items.md` })

/** A plain on/off switch: absent or "false" is off, "true" is on, anything else is refused. */
const flag = () =>
  z
    .enum(['false', 'true'])
    .default('false')
    .transform((value) => value === 'true')

/** An optional setting that may also be given empty (compose passes `${NAME:-}`), which means unset. */
const optional = <T extends z.ZodType>(type: T) => z.preprocess((value) => (value === '' ? undefined : value), type.optional())

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  // Ory Kratos public API, reached server-to-server to validate sessions.
  KRATOS_PUBLIC_URL: z.url().transform((u) => u.replace(/\/$/, '')),
  // Shared secret Kratos presents when it calls our registration webhook.
  KRATOS_WEBHOOK_SECRET: z.string().min(32),
  // Origin browsers use for the web app; the only origin allowed to make writes.
  WEB_PUBLIC_URL: z
    .url()
    .default('http://127.0.0.1:3000')
    .transform((u) => u.replace(/\/$/, '')),
  API_PORT: z.coerce.number().default(4000),
  // Loopback in development. In a container it must be 0.0.0.0 so the web app and
  // Kratos can reach it; the port is never published outside the Docker network.
  API_HOST: z.string().default('127.0.0.1'),
  // Background jobs (image processing) run on BullMQ over this Redis.
  REDIS_URL: z.url(),
  // How long a Kratos whoami answer is reused for the same session cookie, in
  // seconds (see KratosService). 0 asks Kratos on every request.
  WHOAMI_CACHE_TTL_S: z.coerce.number().int().min(0).max(300).default(30),
  // Object storage for media: MinIO locally, Cloudflare R2 in production.
  S3_ENDPOINT: z.url().transform((u) => u.replace(/\/$/, '')),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_UPLOADS_BUCKET: z.string().min(1),
  S3_MEDIA_BUCKET: z.string().min(1),
  // Optional NIN identity verification through an authorised NINAuth provider.
  NIN_VERIFICATION_ENABLED: lockedOff('NIN_VERIFICATION_ENABLED'),
  // Voting membership registration and binding governance ballots.
  BINDING_GOVERNANCE_VOTING_ENABLED: lockedOff('BINDING_GOVERNANCE_VOTING_ENABLED'),
  // Accounts for people under 18. The 18+ beta rule is temporary; this stays off
  // until docs/governance/under-18-rollout.md is approved and built.
  UNDER_18_ACCOUNTS_ENABLED: lockedOff('UNDER_18_ACCOUNTS_ENABLED'),
  // Key for deriving private person keys from a provider's identifier
  // (governance/rules.ts). Only needed once NIN verification exists.
  IDENTITY_KEY_SECRET: z.string().min(32).optional(),
  // Notification emails. They go out over the same SMTP account Kratos uses for
  // sign-in codes (Resend in staging and production, Mailpit locally, see
  // docs/deployment), under the same variable names as infra/deploy/.env.example.
  // Without SMTP_CONNECTION_URI no email is sent: notifications stay in the app.
  SMTP_CONNECTION_URI: z.string().min(1).optional(),
  SMTP_FROM_ADDRESS: z.email().optional(),
  SMTP_FROM_NAME: z.string().min(1).default('HeyNaija'),
  // Kratos's admin API, on the private network only: the one place a member's
  // email address is kept, read when an email is about to be sent.
  KRATOS_ADMIN_URL: z
    .url()
    .transform((u) => u.replace(/\/$/, ''))
    .optional(),
  // How long a notification waits for company before it is emailed, and the least
  // time between two emails to the same member, in seconds (docs/adr/0009).
  EMAIL_DIGEST_DELAY_S: z.coerce.number().int().min(0).max(3600).default(300),
  EMAIL_DIGEST_GAP_S: z.coerce.number().int().min(0).max(86_400).default(1800),
  // How often the job that finds due emails runs, in seconds.
  EMAIL_SWEEP_EVERY_S: z.coerce.number().int().min(1).max(3600).default(60),
  // Push notifications (docs/adr/0011): the VAPID key pair browsers subscribe
  // with, both base64url (infra/scripts/gen-dev-env.sh and infra/deploy/gen-env.sh
  // make one). Without them nothing is pushed and Settings does not offer push.
  // Changing them cuts off every browser that has subscribed until it subscribes again.
  PUSH_VAPID_PUBLIC_KEY: optional(z.string().regex(/^[\w-]{87}$/, 'a P-256 public key in base64url')),
  PUSH_VAPID_PRIVATE_KEY: optional(z.string().regex(/^[\w-]{43}$/, 'a P-256 private key in base64url')),
  // How push services can reach us about our traffic: a mailto: or https: address.
  // Defaults to WEB_PUBLIC_URL, which is enough wherever that is https.
  PUSH_CONTACT: optional(z.string().regex(/^(mailto:|https:\/\/)\S+$/, 'a mailto: or https:// address')),
  // How often the job that pushes new notifications runs, in seconds.
  PUSH_SWEEP_EVERY_S: z.coerce.number().int().min(1).max(600).default(10),
  // Safety (docs/safety/abuse-material-scanning.md). Where alerts about matched
  // uploads and reports of illegal content are emailed; without it they are only
  // logged. Needs the SMTP settings above.
  SAFETY_ALERT_EMAIL: optional(z.email()),
  // PhotoDNA's key, once Microsoft has approved us: with it every upload is
  // hash-matched before it is published; without it every image passes.
  PHOTODNA_SUBSCRIPTION_KEY: optional(z.string().min(1)),
  // Only if Microsoft's documentation gives a different Match address.
  PHOTODNA_MATCH_URL: optional(z.url()),
  // Purging taken-down images from Cloudflare's cache: the heynaija.ng zone and an
  // API token allowed only Zone → Cache Purge. Without them nothing is purged.
  CLOUDFLARE_ZONE_ID: optional(z.string().regex(/^[0-9a-f]{32}$/, 'a Cloudflare zone ID')),
  CLOUDFLARE_PURGE_TOKEN: optional(z.string().min(1)),
  // The media bucket's public custom domain (nginx serves it under /media too), so
  // a purge also clears copies cached under that address.
  MEDIA_ORIGIN: optional(z.url().transform((u) => u.replace(/\/$/, ''))),
  // Calls and Spaces (docs/adr/0017). Everything ships dark: both switches default
  // to false, and with either off (or LiveKit not configured) every Spaces route
  // answers 404 exactly like a route that does not exist.
  CALLS_ENABLED: flag(),
  CALLS_SPACES_ENABLED: flag(),
  // Handles allowed to use calls and Spaces during the beta, comma-separated. Empty
  // means nobody. Temporary: replaced by the real age-verified, opted-in gate (see
  // spaces/eligibility.ts).
  CALLS_MEMBERS: z
    .string()
    .default('')
    .transform((raw) => raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)),
  // The LiveKit server. The URL is what browsers connect to (ws:// or wss://), and
  // the key and secret sign tokens and server calls. Webhooks may be signed with a
  // key of their own; without one the API key is used. Empty means calls are off.
  LIVEKIT_URL: optional(z.string().regex(/^wss?:\/\/\S+$/, 'a ws:// or wss:// address').transform((u) => u.replace(/\/$/, ''))),
  LIVEKIT_API_KEY: optional(z.string().min(1)),
  LIVEKIT_API_SECRET: optional(z.string().min(32)),
  LIVEKIT_WEBHOOK_KEY: optional(z.string().min(1)),
  LIVEKIT_WEBHOOK_SECRET: optional(z.string().min(32)),
  // Spaces limits (docs/adr/0017 section 4a); a load test sets the real numbers.
  SPACES_MAX_COHOSTS: z.coerce.number().int().min(0).max(10).default(2),
  SPACES_MAX_SPEAKERS: z.coerce.number().int().min(0).max(50).default(10),
  SPACES_LISTENER_CAP: z.coerce.number().int().min(1).max(10_000).default(200),
  // Lets browsers subscribe with an http://127.0.0.1 address, for the end-to-end
  // tests' stand-in push service. Only allowed while WEB_PUBLIC_URL is on this machine.
  PUSH_ALLOW_LOOPBACK: z
    .enum(['false', 'true'])
    .default('false')
    .transform((value) => value === 'true'),
})

const checked = schema.superRefine((env, ctx) => {
  if (env.SMTP_CONNECTION_URI) {
    for (const name of ['SMTP_FROM_ADDRESS', 'KRATOS_ADMIN_URL'] as const) {
      if (!env[name]) ctx.addIssue({ code: 'custom', path: [name], message: `${name} is required when SMTP_CONNECTION_URI is set` })
    }
  }
  if (Boolean(env.PUSH_VAPID_PUBLIC_KEY) !== Boolean(env.PUSH_VAPID_PRIVATE_KEY)) {
    ctx.addIssue({ code: 'custom', path: ['PUSH_VAPID_PRIVATE_KEY'], message: 'set both PUSH_VAPID_PUBLIC_KEY and PUSH_VAPID_PRIVATE_KEY, or neither' })
  }
  if (env.PUSH_VAPID_PUBLIC_KEY && !env.PUSH_CONTACT && !env.WEB_PUBLIC_URL.startsWith('https://')) {
    ctx.addIssue({ code: 'custom', path: ['PUSH_CONTACT'], message: 'PUSH_CONTACT is required when WEB_PUBLIC_URL is not https' })
  }
  if (Boolean(env.CLOUDFLARE_ZONE_ID) !== Boolean(env.CLOUDFLARE_PURGE_TOKEN)) {
    ctx.addIssue({ code: 'custom', path: ['CLOUDFLARE_PURGE_TOKEN'], message: 'set both CLOUDFLARE_ZONE_ID and CLOUDFLARE_PURGE_TOKEN, or neither' })
  }
  if (env.SAFETY_ALERT_EMAIL && !env.SMTP_CONNECTION_URI) {
    ctx.addIssue({ code: 'custom', path: ['SAFETY_ALERT_EMAIL'], message: 'SAFETY_ALERT_EMAIL needs SMTP_CONNECTION_URI to send anything' })
  }
  if (Boolean(env.LIVEKIT_WEBHOOK_KEY) !== Boolean(env.LIVEKIT_WEBHOOK_SECRET)) {
    ctx.addIssue({ code: 'custom', path: ['LIVEKIT_WEBHOOK_SECRET'], message: 'set both LIVEKIT_WEBHOOK_KEY and LIVEKIT_WEBHOOK_SECRET, or neither' })
  }
  if (Boolean(env.LIVEKIT_API_KEY) !== Boolean(env.LIVEKIT_API_SECRET)) {
    ctx.addIssue({ code: 'custom', path: ['LIVEKIT_API_SECRET'], message: 'set both LIVEKIT_API_KEY and LIVEKIT_API_SECRET, or neither' })
  }
  if (env.PUSH_ALLOW_LOOPBACK && new URL(env.WEB_PUBLIC_URL).hostname !== '127.0.0.1') {
    ctx.addIssue({ code: 'custom', path: ['PUSH_ALLOW_LOOPBACK'], message: 'PUSH_ALLOW_LOOPBACK is only for a WEB_PUBLIC_URL on 127.0.0.1' })
  }
})

export type Env = z.infer<typeof schema>

export const loadEnv = (source: Record<string, string | undefined> = process.env): Env => checked.parse(source)
