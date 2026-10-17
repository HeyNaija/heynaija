// Maps a Google account to a HeyNaija identity. Only an address Google has
// verified is used, and it counts as verified here too. The handle is not
// mapped: Kratos asks for it on the signup form.
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
