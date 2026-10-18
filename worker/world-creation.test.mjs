import assert from 'node:assert/strict'
import test from 'node:test'
import { createSilenceCreationRun, snapshotSha256 } from './world-creation.ts'

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

test('silence creates a repeatable audited transition', async () => {
  const first = await createSilenceCreationRun(snapshot, snapshot.map)
  const second = await createSilenceCreationRun(snapshot, snapshot.map)

  assert.deepEqual(first, second)
  assert.equal(first.transition.fromDay, 20)
  assert.equal(first.transition.toDay, 21)
  assert.deepEqual(first.transition.operations, [])
  assert.equal(first.expectedSnapshot.worldDay, 21)
  assert.match(first.seed, /^[0-9a-f]{64}$/)
})

test('implicit map expansion is recorded as an operation', async () => {
  const day21 = { ...snapshot, worldDay: 21 }
  const run = await createSilenceCreationRun(day21, { width: 16, height: 16 })

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
