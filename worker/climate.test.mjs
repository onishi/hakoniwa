import assert from 'node:assert/strict'
import test from 'node:test'
import { rainMirrorAvailable, worldClimate } from './climate.ts'

test('published-day weather and the Tokyo clock are deterministic', () => {
  const morning = new Date('2026-10-12T22:00:00Z') // 07:00 JST
  const evening = new Date('2026-10-13T09:00:00Z') // 18:00 JST
  assert.deepEqual(worldClimate(81, morning), {
    phase: 'morning', weather: 'clear', season: null, hour: 7, timeZone: 'Asia/Tokyo',
  })
  assert.equal(worldClimate(83, evening).weather, 'rain')
  assert.equal(worldClimate(84, evening).weather, 'clear')
  assert.equal(worldClimate(84, evening).season, 'sprout')
  assert.equal(worldClimate(94, evening).season, 'sun')
  assert.equal(worldClimate(85, evening).weather, 'rain')
})

test('mirror stone needs both rain and dusk or night', () => {
  assert.equal(rainMirrorAvailable(85, new Date('2026-10-13T09:00:00Z')), true)
  assert.equal(rainMirrorAvailable(85, new Date('2026-10-12T22:00:00Z')), false)
  assert.equal(rainMirrorAvailable(84, new Date('2026-10-13T09:00:00Z')), false)
})
