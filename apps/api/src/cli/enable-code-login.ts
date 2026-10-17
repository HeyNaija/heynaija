// One-off, after the switch from passwords to emailed codes: re-saves every
// identity unchanged, so Kratos adds the email-code credential that accounts
// created with a password lack. Safe to run again.
// Usage: KRATOS_ADMIN_URL=http://kratos:4434 node dist/cli/enable-code-login.js
const admin = process.env.KRATOS_ADMIN_URL ?? 'http://127.0.0.1:4534'

type Identity = {
  id: string
  schema_id: string
  state: string
  traits: unknown
  metadata_public: unknown
  metadata_admin: unknown
}

let updated = 0
let page = `${admin}/admin/identities?page_size=250`
for (;;) {
  const res = await fetch(page)
  if (!res.ok) throw new Error(`listing identities: Kratos responded ${res.status}`)
  for (const i of (await res.json()) as Identity[]) {
    const put = await fetch(`${admin}/admin/identities/${i.id}`, {
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
    if (!put.ok) throw new Error(`updating ${i.id}: Kratos responded ${put.status} ${await put.text()}`)
    updated++
  }
  // Kratos pages with a Link header: <…page_token=…>; rel="next".
  const next = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1]
  if (!next) break
  page = new URL(next, admin).toString()
}
console.log(`${updated} identities can now sign in with an emailed code`)
