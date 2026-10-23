import assert from 'node:assert/strict'
import test from 'node:test'
import { createApprovedProposalRun, snapshotSha256 } from './world-creation.ts'

const snapshot = {
  worldDay: 20,
  map: { width: 12, height: 12 },
  entities: [
    { key: 'tree', kind: 'plant', x: 3, y: 3 },
    { key: 'pond', kind: 'water', x: 7, y: 7 },
  ],
  tiles: [
    { x: 2, y: 6, kind: 'path' },
    { x: 1, y: 6, kind: 'path' },
  ],
}

test('approved silence records implicit map expansion as an operation', async () => {
  const day21 = { ...snapshot, worldDay: 21 }
  const run = await createApprovedProposalRun(day21, { width: 16, height: 16 },
    { version: 1, kind: 'silence', reason: '地図の境界だけを広げる', oracle: null })

  assert.deepEqual(run.transition.operations, [
    { kind: 'set_map', value: { width: 16, height: 16 } },
  ])
  assert.deepEqual(run.expectedSnapshot.map, { width: 16, height: 16 })
})

test('snapshot hashes ignore entity and tile array order', async () => {
  const reordered = {
    ...snapshot,
    entities: [...snapshot.entities].reverse(),
    tiles: [...snapshot.tiles].reverse(),
  }

  assert.equal(await snapshotSha256(snapshot), await snapshotSha256(reordered))
})

const proposal = {
  version: 1,
  kind: 'creation',
  title: '苔むす標石',
  oracle: '小道のそばに、小さな標石を置きました。',
  operations: [
    {
      kind: 'add_entity',
      value: {
        key: 'moss-marker', kind: 'stone', x: 4, y: 4, width: 1, height: 1,
        sprite: 'map-moss-marker', label: '苔むす標石', message: '苔の下に古い印があります。',
        panel: null, flat: false, blocks: true,
      },
    },
    { kind: 'add_tile', value: { x: 4, y: 5, kind: 'moss', elevation: 0, traversal: 'ground' } },
  ],
}

test('approved proposal creates deterministic additions and an exact expected snapshot', async () => {
  const first = await createApprovedProposalRun(snapshot, snapshot.map, proposal)
  const second = await createApprovedProposalRun(snapshot, snapshot.map, proposal)

  assert.deepEqual(first, second)
  assert.equal(first.algorithm, 'approved-proposal-v1')
  assert.deepEqual(first.transition.operations.map(operation => operation.kind), ['upsert_entity', 'upsert_tile'])
  assert.equal(first.expectedSnapshot.worldDay, 21)
  assert.equal(first.expectedSnapshot.entities.find(entity => entity.key === 'moss-marker').label, '苔むす標石')
  assert.deepEqual(first.expectedSnapshot.tiles.map(tile => [tile.x, tile.y]), [[4, 5], [1, 6], [2, 6]])
})

test('approved proposal rejects collisions, unknown fields, and out-of-map entities', async () => {
  const collision = structuredClone(proposal)
  collision.operations[0].value.key = 'tree'
  await assert.rejects(createApprovedProposalRun(snapshot, snapshot.map, collision), /duplicate entity key/)

  const unknown = structuredClone(proposal)
  unknown.debug = true
  await assert.rejects(createApprovedProposalRun(snapshot, snapshot.map, unknown), /unexpected proposal fields/)

  const outside = structuredClone(proposal)
  outside.operations[0].value.x = 10
  outside.operations[0].value.width = 2
  await assert.rejects(createApprovedProposalRun(snapshot, snapshot.map, outside), /outside map/)
})

test('approved silence advances deterministically without changing world contents', async () => {
  const silence = { version: 1, kind: 'silence', reason: '人間が変化を見送った日', oracle: null }
  const run = await createApprovedProposalRun(snapshot, snapshot.map, silence)
  const repeated = await createApprovedProposalRun(snapshot, snapshot.map, silence)

  assert.deepEqual(run, repeated)
  assert.equal(run.algorithm, 'approved-silence-v1')
  assert.deepEqual(run.proposal, silence)
  assert.deepEqual(run.transition.operations, [])
  assert.equal(run.expectedSnapshot.worldDay, 21)
  assert.deepEqual(run.expectedSnapshot.entities, snapshot.entities)
  assert.deepEqual(run.expectedSnapshot.tiles, [...snapshot.tiles].sort((left, right) => left.x - right.x))
  assert.match(run.seed, /^[0-9a-f]{64}$/)
})

test('approved silence rejects missing reasons and extra fields', async () => {
  await assert.rejects(
    createApprovedProposalRun(snapshot, snapshot.map, { version: 1, kind: 'silence', reason: '', oracle: null }),
    /invalid reason/,
  )
  await assert.rejects(
    createApprovedProposalRun(snapshot, snapshot.map,
      { version: 1, kind: 'silence', reason: '見送る', oracle: null, operations: [] }),
    /unexpected proposal fields/,
  )
})
