// Body of the registration webhooks sent to our API. Deliberately minimal: the
// API needs the invite code and IDs, nothing else about the person.
//
// The invite code arrives in the hn_invite cookie, which the web app sets on
// /join after checking the code. identity_id is all zeros until Kratos has saved
// the account.
function(ctx) {
  identity_id: ctx.identity.id,
  invite_code:
    if std.objectHas(ctx, 'request_cookies') && std.objectHas(ctx.request_cookies, 'hn_invite')
    then ctx.request_cookies.hn_invite
    else '',
}
