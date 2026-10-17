// Body of the settings webhook sent to our API just before a change is saved:
// the handle being saved and the one the member had until now (the same when
// they changed something else). Nothing else about the person.
function(ctx) {
  identity_id: ctx.identity.id,
  handle: ctx.identity.traits.handle,
  previous_handle: ctx.flow.identity.traits.handle,
}
