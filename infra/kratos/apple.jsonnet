// Maps an Apple account (Sign in with Apple, in the iOS app) to a HeyNaija
// identity, as google.jsonnet does a Google one. Apple verifies every address it
// gives, including Hide My Email's relay addresses, which then are the account's.
// The handle is not mapped: the app sends it with the signup.
local claims = { email_verified: false } + std.extVar('claims');
local verified = 'email' in claims && claims.email_verified;

{
  identity: {
    traits: {
      [if verified then 'email' else null]: claims.email,
    },
    verified_addresses: if verified then [{ value: claims.email, via: 'email' }] else [],
  },
}
