// Once per server, after deploying the identity schema that makes the handle a
// Kratos credential identifier again: Kratos keeps handles unique through that
// identifier, but only writes it when it saves an identity, so accounts created
// or renamed while it was missing (since the switch to emailed codes) have none
// and their handles can still be copied. This re-saves every identity unchanged.
//
// It first looks for handles that several accounts already share. Kratos can give
// each of those to only one account, so if it finds any it lists them and changes
// nothing: rename all but one (in Kratos), then run it again. Safe to run again.
// Usage: KRATOS_ADMIN_URL=http://kratos:4434 node dist/cli/unique-handles.js [--check]
//   --check  only look for shared handles
import { parseArgs } from 'node:util'

const admin = process.env.KRATOS_ADMIN_URL ?? 'http://127.0.0.1:4534'
const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } } })

type Identity = {
  id: string
  schema_id: string
  state: string
  created_at: string
  traits: { handle?: string }
  metadata_public: unknown
  metadata_admin: unknown
}

const identities: Identity[] = []
let page = `${admin}/admin/identities?page_size=250`
for (;;) {
  const res = await fetch(page)
  if (!res.ok) throw new Error(`listing identities: Kratos responded ${res.status}`)
  identities.push(...((await res.json()) as Identity[]))
  // Kratos pages with a Link header: <…page_token=…>; rel="next".
  const next = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1]
  if (!next) break
  page = new URL(next, admin).toString()
}

// Kratos compares identifiers in lower case.
const byHandle = new Map<string, Identity[]>()
for (const i of identities) {
  const handle = i.traits.handle?.toLowerCase()
  if (handle) byHandle.set(handle, [...(byHandle.get(handle) ?? []), i])
}
const shared = [...byHandle].filter(([, owners]) => owners.length > 1)
if (shared.length) {
  console.error(`${shared.length} handle(s) belong to more than one account, oldest first. Nothing was changed.`)
  for (const [handle, owners] of shared) {
    console.error(`@${handle}`)
    for (const i of owners.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      console.error(`  ${i.id}  created ${i.created_at}`)
    }
  }
  console.error('Give all but one of each a new handle (PATCH /admin/identities/<id>), then run this again.')
  process.exit(1)
}
if (values.check) {
  console.log(`no shared handles among ${identities.length} identities`)
  process.exit(0)
}

/** Re-saves each identity; returns those Kratos refused because their handle is held. */
async function saveAll(batch: Identity[]) {
  const refused: Identity[] = []
  for (const i of batch) {
    const res = await fetch(`${admin}/admin/identities/${i.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schema_id: i.schema_id,
        state: i.state,
        traits: i.traits,
        metadata_public: i.metadata_public,
        metadata_admin: i.metadata_admin,
      }),
    })
    if (res.status === 409) refused.push(i)
    else if (!res.ok) throw new Error(`updating ${i.id}: Kratos responded ${res.status} ${await res.text()}`)
  }
  return refused
}

// With no shared handles, a conflict can only be with a handle another account
// still holds from before it was renamed. Saving that account lets it go, so the
// refused ones get a second try once everyone has been saved.
const conflicts = await saveAll(await saveAll(identities))

console.log(`${identities.length - conflicts.length} of ${identities.length} identities now hold their handle`)
if (conflicts.length) {
  console.error('Kratos refused these, because another account holds their handle:')
  for (const i of conflicts) console.error(`  ${i.id}  @${i.traits.handle}`)
  process.exitCode = 1
}
