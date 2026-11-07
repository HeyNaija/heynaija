// Body of the registration webhooks sent to our API. Deliberately minimal: the
// API needs the invite code and IDs, the handle (to refuse one that someone
// gave up recently) and the date of birth the person typed, nothing else about
// the person.
//
// On the web the invite code arrives in the hn_invite cookie, and the date of
// birth (YYYY-MM-DD) in the hn_age cookie, both set by the web app on /join. The
// Android and iOS apps have no cookies: they send both in the signup's
// transient_payload, as invite_code and birth_date. A cookie wins over the payload.
// identity_id is all zeros until Kratos has saved the account.
function(ctx)
  local cookies = if std.objectHas(ctx, 'request_cookies') then ctx.request_cookies else {};
  local flow = if std.objectHas(ctx, 'flow') && ctx.flow != null then ctx.flow else {};
  local payload = if std.objectHas(flow, 'transient_payload') && std.isObject(flow.transient_payload) then flow.transient_payload else {};
  local field(cookie, key) =
    if std.objectHas(cookies, cookie) then cookies[cookie]
    else if std.objectHas(payload, key) && std.isString(payload[key]) then payload[key]
    else '';
  {
    identity_id: ctx.identity.id,
    handle: ctx.identity.traits.handle,
    invite_code: field('hn_invite', 'invite_code'),
    birth_date: field('hn_age', 'birth_date'),
  }
