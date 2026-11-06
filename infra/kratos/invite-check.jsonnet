// Body of the registration webhooks sent to our API. Deliberately minimal: the
// API needs the invite code and IDs, the handle (to refuse one that someone
// gave up recently) and the date of birth the person typed, nothing else about
// the person.
//
// The invite code arrives in the hn_invite cookie, and the date of birth
// (YYYY-MM-DD) in the hn_age cookie, both set by the web app on /join.
// identity_id is all zeros until Kratos has saved the account.
function(ctx)
  local cookies = if std.objectHas(ctx, 'request_cookies') then ctx.request_cookies else {};
  {
    identity_id: ctx.identity.id,
    handle: ctx.identity.traits.handle,
    invite_code: if std.objectHas(cookies, 'hn_invite') then cookies.hn_invite else '',
    birth_date: if std.objectHas(cookies, 'hn_age') then cookies.hn_age else '',
  }
