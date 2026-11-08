// Body of the registration webhooks sent to our API. Deliberately minimal: the
// API needs the invite code and IDs, the handle (to refuse one that someone
// gave up recently) and the person's age as they stated it, nothing else about
// the person.
//
// On the web the invite code arrives in the hn_invite cookie, and the age in the
// hn_age cookie, both set by the web app on /join: "18-plus" when they ticked "I
// am 18 or older", or a date of birth (YYYY-MM-DD) while signup asks for one
// (BIRTH_DATE_ENABLED in the API). The Android and iOS apps have no cookies: they
// send them in the signup's transient_payload, as invite_code and birth_date, or
// adult_declared: true for the box. A cookie wins over the payload. identity_id
// is all zeros until Kratos has saved the account.
function(ctx)
  local cookies = if std.objectHas(ctx, 'request_cookies') then ctx.request_cookies else {};
  local flow = if std.objectHas(ctx, 'flow') && ctx.flow != null then ctx.flow else {};
  local payload = if std.objectHas(flow, 'transient_payload') && std.isObject(flow.transient_payload) then flow.transient_payload else {};
  local field(cookie, key) =
    if std.objectHas(cookies, cookie) then cookies[cookie]
    else if std.objectHas(payload, key) && std.isString(payload[key]) then payload[key]
    else '';
  local age = field('hn_age', 'birth_date');
  {
    identity_id: ctx.identity.id,
    handle: ctx.identity.traits.handle,
    invite_code: field('hn_invite', 'invite_code'),
    birth_date: if age == '18-plus' then '' else age,
    adult_declared: age == '18-plus' || (!std.objectHas(cookies, 'hn_age') && std.objectHas(payload, 'adult_declared') && payload.adult_declared == true),
  }
