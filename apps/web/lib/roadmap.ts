import registry from '../../../docs/feature-roadmap.json' with { type: 'json' }

export const PRIORITIES = {
  P0: 'Safe and usable public beta',
  P1: 'Core engagement',
  P2: 'Growth and community',
  P3: 'Later experiments',
} as const

export const STATUSES = {
  implemented: { label: 'Implemented', definition: 'Working behaviour is supported by application code and tests. Deployment is tracked separately.' },
  partial: { label: 'Partial', definition: 'A working subset exists, with remaining work or verification stated.' },
  planned: { label: 'Planned', definition: 'Proposed work without a working implementation of the described feature.' },
  blocked: { label: 'Blocked', definition: 'Progress needs an external approval, decision or prerequisite.' },
} as const

export const AVAILABILITY = {
  staging: 'Recorded on staging',
  not_live: 'Not live',
  unknown: 'Availability not verified',
} as const

export const CATEGORIES = {
  accounts: 'Accounts and access',
  conversations: 'Conversations and feeds',
  discovery: 'People and discovery',
  safety: 'Safety and privacy',
  operations: 'Reliability and access',
  governance: 'Transparency and governance',
  expansion: 'Community expansion',
} as const

export type Priority = keyof typeof PRIORITIES
export type FeatureStatus = keyof typeof STATUSES
export type Feature = {
  id: string
  name: string
  description: string
  category: keyof typeof CATEGORIES
  priority: Priority
  status: FeatureStatus
  availability: keyof typeof AVAILABILITY
  evidence: string[]
  caveat?: string
  dependency?: string[]
  notes?: string
}
export type Roadmap = { schemaVersion: 1; scope: string; features: Feature[] }

/** The generator, website and tests all reject an invalid registry. */
export function validateRoadmap(value: unknown): Roadmap {
  const fail = (message: string): never => { throw new Error(`Invalid roadmap: ${message}`) }
  const object = (item: unknown): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item)
  const nonempty = (item: unknown): item is string => typeof item === 'string' && item.trim().length > 0
  const keys = ['id', 'name', 'description', 'category', 'priority', 'status', 'availability', 'evidence', 'caveat', 'dependency', 'notes']
  if (!object(value) || value.schemaVersion !== 1 || !nonempty(value.scope) || !Array.isArray(value.features) || !value.features.length) {
    return fail('expected schemaVersion 1, a scope and a non-empty features array')
  }
  if (Object.keys(value).some((key) => !['schemaVersion', 'scope', 'features'].includes(key))) fail('unknown registry field')
  const ids = new Set<string>()
  for (const feature of value.features) {
    if (!object(feature) || Object.keys(feature).some((key) => !keys.includes(key))) fail('unknown feature field')
    for (const field of ['id', 'name', 'description']) if (!nonempty(feature[field])) fail(`missing ${field}`)
    const id = feature.id as string
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) || ids.has(id)) fail(`invalid or duplicate id ${id}`)
    ids.add(id)
    for (const [field, choices] of Object.entries({ priority: PRIORITIES, status: STATUSES, availability: AVAILABILITY, category: CATEGORIES })) {
      if (typeof feature[field] !== 'string' || !Object.hasOwn(choices, feature[field] as string)) fail(`${id}: invalid ${field}`)
    }
    if (!Array.isArray(feature.evidence) || !feature.evidence.length || !feature.evidence.every(nonempty)) fail(`${id}: evidence required`)
    for (const field of ['caveat', 'notes']) if (feature[field] !== undefined && !nonempty(feature[field])) fail(`${id}: invalid ${field}`)
    if (['partial', 'blocked'].includes(feature.status as string) && !nonempty(feature.caveat)) fail(`${id}: public caveat required`)
    if (feature.status === 'implemented') {
      if (!feature.evidence.some((path: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) ||
          !feature.evidence.some((path: string) => /\.[cm]?[jt]sx?$/.test(path) && !/\.(test|spec)\./.test(path))) fail(`${id}: implementation and test evidence required`)
    }
    if (feature.status === 'planned' && feature.availability !== 'not_live') fail(`${id}: planned features must be not_live`)
    if (feature.dependency !== undefined && (!Array.isArray(feature.dependency) || !feature.dependency.every(nonempty))) fail(`${id}: invalid dependencies`)
  }
  const roadmap = value as Roadmap
  for (const feature of roadmap.features) {
    const dependencies = feature.dependency ?? []
    if (new Set(dependencies).size !== dependencies.length || dependencies.some((id) => id === feature.id || !ids.has(id))) fail(`${feature.id}: invalid dependency reference`)
  }
  const visit = (id: string, active: Set<string>, done: Set<string>) => {
    if (active.has(id)) fail(`dependency cycle at ${id}`)
    if (done.has(id)) return
    active.add(id)
    for (const dependency of roadmap.features.find((feature) => feature.id === id)!.dependency ?? []) visit(dependency, active, done)
    active.delete(id)
    done.add(id)
  }
  const done = new Set<string>()
  for (const id of ids) visit(id, new Set(), done)
  return roadmap
}

export const ROADMAP = validateRoadmap(registry)

export function statusCounts(features: Feature[]) {
  return Object.fromEntries(Object.keys(STATUSES).map((status) => [status, features.filter((feature) => feature.status === status).length])) as Record<FeatureStatus, number>
}

export function roadmapGroups(features: Feature[]) {
  return (Object.keys(PRIORITIES) as Priority[]).map((priority) => ({
    priority,
    categories: (Object.keys(CATEGORIES) as Feature['category'][]).map((category) => ({
      category,
      features: features.filter((feature) => feature.priority === priority && feature.category === category),
    })).filter((group) => group.features.length),
  }))
}
