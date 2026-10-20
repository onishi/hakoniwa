export type SharedWorldEntity = {
  key: string; kind: string; x: number; y: number; width: number; height: number
  sprite: string; label: string; message: string; panel: string | null; flat: boolean; blocks: boolean
}
export type SharedWorldTile = { x: number; y: number; kind: string; elevation: number; traversal: 'ground' | 'slope' | 'water' }
export type SharedWorldSnapshot = {
  worldDay: number
  map: { width: number; height: number }
  entities: Array<{ key: string; [key: string]: unknown }>
  tiles: Array<{ x: number; y: number; [key: string]: unknown }>
}
export type ApprovedCreationProposal = {
  version: 1; kind: 'creation'; title: string; oracle: string | null
  operations: Array<{ kind: 'add_entity'; value: SharedWorldEntity } | { kind: 'add_tile'; value: SharedWorldTile }>
}
export type ApprovedSilenceProposal = {
  version: 1; kind: 'silence'; reason: string; oracle: string | null
}
export type ApprovedProposal = ApprovedCreationProposal | ApprovedSilenceProposal
type TransitionOperation = { kind: 'set_map'; value: SharedWorldSnapshot['map'] }
  | { kind: 'upsert_entity'; value: SharedWorldEntity }
  | { kind: 'upsert_tile'; value: SharedWorldTile }
export type CreationRun = {
  algorithm: 'approved-proposal-v1' | 'approved-silence-v1'
  proposal: ApprovedProposal
  seed: string
  transition: { version: 1; fromDay: number; toDay: number; beforeSha256: string; afterSha256: string; operations: TransitionOperation[] }
  expectedSnapshot: SharedWorldSnapshot
}

const MAX_OPERATIONS = 32
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
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
const sqlProjectionOrder = (snapshot: SharedWorldSnapshot): SharedWorldSnapshot => ({
  ...snapshot,
  entities: [...snapshot.entities].sort((left, right) =>
    Number(left.y) - Number(right.y) || Number(left.x) - Number(right.x) || left.key.localeCompare(right.key)),
  tiles: [...snapshot.tiles].sort((left, right) => left.y - right.y || left.x - right.x),
})
const sha256 = async (value: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
export const snapshotSha256 = (snapshot: SharedWorldSnapshot) => sha256(canonicalJson(normalizedSnapshot(snapshot)))
const boundedString = (record: Record<string, unknown>, name: string, max: number, pattern?: RegExp) => {
  const value = record[name]
  if (typeof value !== 'string' || value.length < 1 || value.length > max || (pattern && !pattern.test(value))) throw new Error(`invalid ${name}`)
  return value
}
const integer = (record: Record<string, unknown>, name: string, min: number, max: number) => {
  const value = record[name]
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`invalid ${name}`)
  return value as number
}
const exactKeys = (record: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(record).length !== keys.length || keys.some(key => !(key in record))) throw new Error('unexpected proposal fields')
}

export function parseApprovedProposal(value: unknown, source: SharedWorldSnapshot,
  targetMap: SharedWorldSnapshot['map']): ApprovedProposal {
  if (!isRecord(value)) throw new Error('proposal must be an object')
  if (value.version !== 1 || value.kind !== 'creation' && value.kind !== 'silence') {
    throw new Error('unsupported proposal version or kind')
  }
  if (value.kind === 'silence') {
    exactKeys(value, ['version', 'kind', 'reason', 'oracle'])
    return {
      version: 1,
      kind: 'silence',
      reason: boundedString(value, 'reason', 500),
      oracle: value.oracle === null ? null : boundedString(value, 'oracle', 500),
    }
  }
  exactKeys(value, ['version', 'kind', 'title', 'oracle', 'operations'])
  const title = boundedString(value, 'title', 120)
  const oracle = value.oracle === null ? null : boundedString(value, 'oracle', 500)
  if (!Array.isArray(value.operations) || value.operations.length < 1 || value.operations.length > MAX_OPERATIONS) {
    throw new Error(`operations must contain 1-${MAX_OPERATIONS} items`)
  }
  const existingEntityKeys = new Set(source.entities.map(entity => entity.key))
  const existingTileKeys = new Set(source.tiles.map(tile => `${tile.x},${tile.y}`))
  const proposedEntityKeys = new Set<string>()
  const proposedTileKeys = new Set<string>()
  const operations: ApprovedCreationProposal['operations'] = value.operations.map((operation, index) => {
    if (!isRecord(operation) || operation.kind !== 'add_entity' && operation.kind !== 'add_tile' || !isRecord(operation.value)) {
      throw new Error(`invalid operation ${index}`)
    }
    exactKeys(operation, ['kind', 'value'])
    const candidate = operation.value
    if (operation.kind === 'add_entity') {
      exactKeys(candidate, ['key', 'kind', 'x', 'y', 'width', 'height', 'sprite', 'label', 'message', 'panel', 'flat', 'blocks'])
      const entity: SharedWorldEntity = {
        key: boundedString(candidate, 'key', 80, /^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        kind: boundedString(candidate, 'kind', 40, /^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        x: integer(candidate, 'x', 1, targetMap.width - 2), y: integer(candidate, 'y', 1, targetMap.height - 2),
        width: integer(candidate, 'width', 1, 8), height: integer(candidate, 'height', 1, 8),
        sprite: boundedString(candidate, 'sprite', 80, /^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        label: boundedString(candidate, 'label', 120), message: boundedString(candidate, 'message', 1000),
        panel: candidate.panel === null ? null : boundedString(candidate, 'panel', 80, /^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        flat: candidate.flat as boolean, blocks: candidate.blocks as boolean,
      }
      if (typeof entity.flat !== 'boolean' || typeof entity.blocks !== 'boolean') throw new Error(`invalid boolean in operation ${index}`)
      if (entity.x + entity.width - 1 > targetMap.width - 2 || entity.y + entity.height - 1 > targetMap.height - 2) {
        throw new Error(`entity outside map in operation ${index}`)
      }
      if (existingEntityKeys.has(entity.key) || proposedEntityKeys.has(entity.key)) throw new Error(`duplicate entity key: ${entity.key}`)
      proposedEntityKeys.add(entity.key)
      return { kind: 'add_entity', value: entity }
    }
    exactKeys(candidate, ['x', 'y', 'kind', 'elevation', 'traversal'])
    const traversal = candidate.traversal
    if (traversal !== 'ground' && traversal !== 'slope' && traversal !== 'water') throw new Error(`invalid traversal in operation ${index}`)
    const tile: SharedWorldTile = {
      x: integer(candidate, 'x', 1, targetMap.width - 2), y: integer(candidate, 'y', 1, targetMap.height - 2),
      kind: boundedString(candidate, 'kind', 40, /^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      elevation: integer(candidate, 'elevation', -8, 8), traversal,
    }
    const tileKey = `${tile.x},${tile.y}`
    if (existingTileKeys.has(tileKey) || proposedTileKeys.has(tileKey)) throw new Error(`duplicate tile coordinates: ${tileKey}`)
    proposedTileKeys.add(tileKey)
    return { kind: 'add_tile', value: tile }
  })
  return { version: 1, kind: 'creation', title, oracle, operations }
}

export async function createApprovedProposalRun(source: SharedWorldSnapshot, targetMap: SharedWorldSnapshot['map'],
  rawProposal: unknown): Promise<CreationRun> {
  if (!Number.isInteger(source.worldDay) || source.worldDay < 1) throw new Error('invalid source world day')
  const toDay = source.worldDay + 1
  const proposal = parseApprovedProposal(rawProposal, source, targetMap)
  const operations: TransitionOperation[] = []
  if (source.map.width !== targetMap.width || source.map.height !== targetMap.height) operations.push({ kind: 'set_map', value: clone(targetMap) })
  const expectedSnapshot = clone(source)
  expectedSnapshot.worldDay = toDay
  expectedSnapshot.map = clone(targetMap)
  if (proposal.kind === 'creation') {
    for (const operation of proposal.operations) {
      if (operation.kind === 'add_entity') {
        expectedSnapshot.entities.push(clone(operation.value))
        operations.push({ kind: 'upsert_entity', value: clone(operation.value) })
      } else {
        expectedSnapshot.tiles.push(clone(operation.value))
        operations.push({ kind: 'upsert_tile', value: clone(operation.value) })
      }
    }
  }
  const orderedExpectedSnapshot = sqlProjectionOrder(expectedSnapshot)
  const beforeSha256 = await snapshotSha256(source)
  const afterSha256 = await snapshotSha256(orderedExpectedSnapshot)
  const algorithm = proposal.kind === 'creation' ? 'approved-proposal-v1' : 'approved-silence-v1'
  const seed = await sha256(canonicalJson({ algorithm, fromDay: source.worldDay, toDay, beforeSha256, proposal }))
  return {
    algorithm, proposal, seed,
    transition: { version: 1, fromDay: source.worldDay, toDay, beforeSha256, afterSha256, operations },
    expectedSnapshot: orderedExpectedSnapshot,
  }
}
