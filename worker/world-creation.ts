export type SharedWorldSnapshot = {
  worldDay: number
  map: { width: number; height: number }
  entities: Array<{ key: string; [key: string]: unknown }>
  tiles: Array<{ x: number; y: number; [key: string]: unknown }>
}

type TransitionOperation =
  | { kind: 'set_map'; value: SharedWorldSnapshot['map'] }

export type CreationRun = {
  algorithm: 'silence-v1'
  proposal: { version: 1; kind: 'silence'; reason: 'no-approved-proposal' }
  seed: string
  transition: {
    version: 1
    fromDay: number
    toDay: number
    beforeSha256: string
    afterSha256: string
    operations: TransitionOperation[]
  }
  expectedSnapshot: SharedWorldSnapshot
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const canonicalJson = (value: unknown): string => {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number is not valid JSON')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  throw new Error(`unsupported JSON value: ${typeof value}`)
}

const normalizedSnapshot = (snapshot: SharedWorldSnapshot) => ({
  ...clone(snapshot),
  entities: clone(snapshot.entities).sort((left, right) => left.key.localeCompare(right.key)),
  tiles: clone(snapshot.tiles).sort((left, right) => left.y - right.y || left.x - right.x),
})

const sha256 = async (value: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export const snapshotSha256 = (snapshot: SharedWorldSnapshot) =>
  sha256(canonicalJson(normalizedSnapshot(snapshot)))

export async function createSilenceCreationRun(
  source: SharedWorldSnapshot,
  targetMap: SharedWorldSnapshot['map'],
): Promise<CreationRun> {
  if (!Number.isInteger(source.worldDay) || source.worldDay < 1) throw new Error('invalid source world day')
  const toDay = source.worldDay + 1
  const proposal = { version: 1, kind: 'silence', reason: 'no-approved-proposal' } as const
  const operations: TransitionOperation[] = []
  if (source.map.width !== targetMap.width || source.map.height !== targetMap.height) {
    operations.push({ kind: 'set_map', value: clone(targetMap) })
  }

  // Preserve SQL projection order in the stored expectation. Hashing separately
  // normalizes collection order so the audit digest is stable across readers.
  const expectedSnapshot = clone(source)
  expectedSnapshot.worldDay = toDay
  expectedSnapshot.map = clone(targetMap)
  const beforeSha256 = await snapshotSha256(source)
  const afterSha256 = await snapshotSha256(expectedSnapshot)
  const seed = await sha256(canonicalJson({
    algorithm: 'silence-v1', fromDay: source.worldDay, toDay, beforeSha256, proposal,
  }))

  return {
    algorithm: 'silence-v1',
    proposal,
    seed,
    transition: {
      version: 1,
      fromDay: source.worldDay,
      toDay,
      beforeSha256,
      afterSha256,
      operations,
    },
    expectedSnapshot,
  }
}
