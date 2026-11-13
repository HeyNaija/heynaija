import 'reflect-metadata'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PlatformModule } from './platform.module.js'
import { PostsService } from './posts/posts.service.js'

// Nest gives a provider only what its own module provides or imports. PostsService lives in
// PlatformModule, and most of what it asks for is optional, so a helper provided in AppModule
// instead would be left out without an error: posts would run on defaults.
test('everything PostsService asks for is provided beside it in PlatformModule', () => {
  const provided = new Set(
    (Reflect.getMetadata('providers', PlatformModule) as (object | { provide: unknown })[]).map((p) => ('provide' in p ? p.provide : p)),
  )
  const asked = (Reflect.getMetadata('self:paramtypes', PostsService) as { index: number; param: unknown }[]).map(({ param }) => param)
  assert.ok(asked.length >= 4, 'PostsService names what it injects')
  for (const token of asked) assert.ok(provided.has(token), `PlatformModule does not provide ${String(token)}`)
})
