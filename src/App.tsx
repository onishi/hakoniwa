import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'

type Position = { x: number; y: number }
type Direction = 'up' | 'down' | 'left' | 'right'
type Traversal = 'ground' | 'slope' | 'water'
type Panel = 'diary' | 'wish' | 'account' | 'inventory' | 'choices' | 'field-guide' | null
type Activity = 'fishing' | 'garden' | 'gathering' | 'observation'
const activities: { key: Activity; label: string; hint: string }[] = [
  { key: 'fishing', label: '釣り', hint: '池で竿を借り、魚を釣って戻す' },
  { key: 'garden', label: '庭', hint: '土を耕し、種を植えて水をやる' },
  { key: 'gathering', label: '採集', hint: '果樹や資源のそばで素材を集める' },
  { key: 'observation', label: '観察', hint: '池と東の泉で生き物の違いを見る' },
]
/** A day the god stayed silent still has an entry; its body is simply missing. */
type DiaryEntry = { worldDay: number; body: string | null; screenshotUrl: string | null }
const diaryThemes = [
  { key: 'all', label: 'すべて', pattern: /./ },
  { key: 'water', label: '水辺', pattern: /池|水|泉|川|小川|魚|釣|葦|雨/ },
  { key: 'life', label: '生き物', pattern: /虫|鳥|獣|生き物|羽|巣|訪問者|トンボ/ },
  { key: 'garden', label: '庭と素材', pattern: /庭|花|草|木|土|芽|実|種|素材|作業台/ },
  { key: 'journey', label: '旅', pattern: /道|外|草原|旅|帰|歩|丘|東/ },
] as const
type SessionUser = { name: string; avatarUrl: string | null }
type AppMode = 'production' | 'day1' | 'evolution'
type HabitatCare = { preparedDay: number; flowerColor: 'white' | 'yellow'; revisited: boolean }
type FieldEntry = { key: string; label: string; firstSeenDay: number; note: string; absent: boolean }
type ExpeditionState = { hp: number; maxHp: number; trips: number; readiness: boolean;
  inside: boolean; encounter: 'idle' | 'active'; calmed: boolean; defeats: number }

type WorldObject = {
  key: string
  kind: string
  x: number
  y: number
  width: number
  height: number
  sprite: string
  message: string
  label: string
  panel: Exclude<Panel, null> | null
  /** Flat ground-level features (no standing silhouette) sit in the ground layer instead of the depth-sorted layer. */
  flat: boolean
  blocks: boolean
}

type WorldTile = { x: number; y: number; kind: string; elevation?: number; traversal?: Traversal }
type GroundTile = Position & { path: boolean; kind: string; elevation: number; traversal: Traversal }

type WorldResponse = {
  worldDay: number
  oracle: string | null
  climate?: WorldClimate | null
  map: { width: number; height: number }
  entities: WorldObject[]
  tiles: WorldTile[]
}

type WorldClimate = { phase: 'morning' | 'evening' | 'night'; weather: 'clear' | 'cloud' | 'rain'; season: 'sprout' | 'sun' | 'harvest' | 'frost' | null; hour: number; timeZone: 'Asia/Tokyo' }

const WALK_MIN = 1

// The last world and diary that arrived, so an outage shows yesterday's garden
// instead of an empty screen. Browser storage can be absent or throw, so every
// access is guarded and the game works without it.
const WORLD_CACHE = 'hakoniwa_last_world'
const DIARY_CACHE = 'hakoniwa_last_diary'

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

function writeCache(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private windows and blocked storage are fine; the world simply is not kept.
  }
}

/** Everything the renderer needs for one world day, derived once per fetch. */
type World = {
  day: number
  climate: WorldClimate | null
  width: number
  height: number
  walkMaxX: number
  walkMaxY: number
  objects: WorldObject[]
  occupiedTiles: Map<string, WorldObject>
  interactionTiles: Map<string, WorldObject>
  groundTiles: GroundTile[]
  tileMap: Map<string, GroundTile>
  fencePoints: string
  isoUnits: (gx: number, gy: number) => { ux: number; uy: number }
}

const buildWorld = (data: WorldResponse): World => {
  const { width, height } = data.map
  const walkMaxX = width - 2
  const walkMaxY = height - 2

  // Isometric (2:1 diamond) projection: screen offset in half-tile units from the map's left corner.
  const isoUnits = (gx: number, gy: number) => ({ ux: gx - gy + height, uy: gx + gy })

  const occupiedTiles = new Map<string, WorldObject>()
  const interactionTiles = new Map<string, WorldObject>()
  for (const object of data.entities) {
    for (let y = 0; y < object.height; y += 1) {
      for (let x = 0; x < object.width; x += 1) {
        const key = `${object.x + x},${object.y + y}`
        const existing = interactionTiles.get(key)
        if (!existing || (existing.kind === 'creature' && object.kind !== 'creature')) interactionTiles.set(key, object)
        if (object.blocks && object.kind !== 'creature') occupiedTiles.set(key, object)
      }
    }
  }

  const tileData = new Map<string, WorldTile>()
  for (const tile of data.tiles) {
    const key = `${tile.x},${tile.y}`
    const prior = tileData.get(key)
    tileData.set(key, { ...prior, ...tile, elevation: tile.elevation ?? prior?.elevation ?? 0,
      traversal: tile.traversal ?? prior?.traversal ?? 'ground' })
  }
  const groundTiles: GroundTile[] = []
  const tileMap = new Map<string, GroundTile>()
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tile = tileData.get(`${x},${y}`)
      const ground = { x, y, path: tile?.kind === 'path', kind: tile?.kind ?? 'grass',
        elevation: tile?.elevation ?? 0, traversal: tile?.traversal ?? 'ground' }
      groundTiles.push(ground)
      tileMap.set(`${x},${y}`, ground)
    }
  }

  const isoSpan = width + height
  const isoPercent = (gx: number, gy: number) => {
    const { ux, uy } = isoUnits(gx, gy)
    return { x: (ux / isoSpan) * 100, y: (uy / isoSpan) * 100 }
  }

  // The fence traces the outer edge of the walkable tiles, so it marks exactly where movement stops.
  const fencePoints = [
    isoPercent(WALK_MIN, WALK_MIN),
    isoPercent(walkMaxX + 1, WALK_MIN),
    isoPercent(walkMaxX + 1, walkMaxY + 1),
    isoPercent(WALK_MIN, walkMaxY + 1),
  ].map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')

  return {
    day: data.worldDay,
    climate: data.climate ?? null,
    width,
    height,
    walkMaxX,
    walkMaxY,
    objects: data.entities,
    occupiedTiles,
    interactionTiles,
    groundTiles,
    tileMap,
    fencePoints,
    isoUnits,
  }
}

const directionVectors: Record<Direction, Position> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

function App() {
  const [position, setPosition] = useState<Position>({ x: 5, y: 9 })
  const [direction, setDirection] = useState<Direction>('up')
  const [message, setMessage] = useState('')
  const [panel, setPanel] = useState<Panel>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [mode, setMode] = useState<AppMode>('production')
  const [diary, setDiary] = useState<DiaryEntry[]>([
    { worldDay: 1, body: '土と木と池を創りました。あなたが来てくれて、うれしい。', screenshotUrl: null },
  ])
  const [diaryTheme, setDiaryTheme] = useState<(typeof diaryThemes)[number]['key']>('all')
  const [diaryQuery, setDiaryQuery] = useState('')
  const [wish, setWish] = useState('')
  const [wishStatus, setWishStatus] = useState('')
  const [publicConsent, setPublicConsent] = useState(false)
  const [ready, setReady] = useState(false)
  const [world, setWorld] = useState<World | null>(null)
  const [inventory, setInventory] = useState<{ key: string; label?: string; quantity: number; firstPickedDay: number }[]>([])
  const [inventoryStatus, setInventoryStatus] = useState('')
  const [fishingState, setFishingState] = useState<'idle' | 'cast' | 'caught'>('idle')
  const [streamFishingState, setStreamFishingState] = useState<'idle' | 'cast' | 'caught'>('idle')
  const [observedHabitats, setObservedHabitats] = useState<string[]>([])
  const [lastReleaseHabitat, setLastReleaseHabitat] = useState<string | null>(null)
  const [bankSeen, setBankSeen] = useState(false)
  const [habitatCare, setHabitatCare] = useState<HabitatCare | null>(null)
  const [dayPhase, setDayPhase] = useState<'morning' | 'evening'>(() => new Date().getHours() >= 17 ? 'evening' : 'morning')
  const [activity, setActivity] = useState<Activity | null>(null)
  const [activityComplete, setActivityComplete] = useState(false)
  const [eastSeen, setEastSeen] = useState(false)
  const [watersCompared, setWatersCompared] = useState(false)
  const [gardenSignals, setGardenSignals] = useState<{ water: boolean; flower: boolean; spring: boolean; ready: boolean } | null>(null)
  const [gardenVisitSeen, setGardenVisitSeen] = useState(false)
  const [todayEcologyEvents, setTodayEcologyEvents] = useState<string[]>([])
  const [fieldEntries, setFieldEntries] = useState<FieldEntry[]>([])
  const [expedition, setExpedition] = useState<ExpeditionState | null>(null)
  const [insectState, setInsectState] = useState<'free' | 'held'>('free')
  const [insectReleased, setInsectReleased] = useState(false)
  const [flowerTended, setFlowerTended] = useState(false)
  const [flowerColor, setFlowerColor] = useState<'white' | 'yellow'>('white')
  /** The world came from the cache, so nothing this visit does is written back. */
  const [offline, setOffline] = useState(false)
  const saveTimer = useRef<number | undefined>(undefined)
  const lastKeyboardMove = useRef(0)
  const playerRef = useRef<HTMLDivElement | null>(null)
  const captureMode = new URLSearchParams(location.search).has('capture')

  const refreshHabitatCare = useCallback(() => {
    fetch('/api/habitat-care').then(response => response.ok ? response.json() : null)
      .then(data => setHabitatCare(data?.care ?? null)).catch(() => undefined)
  }, [])

  const completeActivity = useCallback((kind: Activity) => {
    if (activity === kind) setActivityComplete(true)
  }, [activity])

  const travelAction = useCallback((action: 'enter' | 'return' | 'contact' | 'avoid' | 'calm', at: Position) => {
    if (!user) {
      setMessage('外の旅を記録するには、まず記録を始めてください。')
      return
    }
    fetch('/api/expedition', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, x: at.x, y: at.y }) })
      .then(async response => ({ response, result: await response.json() as {
        error?: string; message?: string; expedition?: ExpeditionState; returnTo?: Position | null,
      } }))
      .then(({ response, result }) => {
        setMessage(response.ok ? result.message ?? '' : result.error ?? '旅を記録できませんでした。')
        if (!response.ok) return
        if (result.expedition) setExpedition(result.expedition)
        if (result.returnTo) setPosition(result.returnTo)
      }).catch(() => setMessage('旅を記録できませんでした。'))
  }, [user])

  const move = useCallback((nextDirection: Direction) => {
    if (!world) return
    const vector = directionVectors[nextDirection]
    setDirection(nextDirection)
    const next = { x: position.x + vector.x, y: position.y + vector.y }
    const outsideMap = next.x < WALK_MIN || next.x > world.walkMaxX || next.y < WALK_MIN || next.y > world.walkMaxY
    if (outsideMap) return
    const obstacle = world.occupiedTiles.get(`${next.x},${next.y}`)
    if (obstacle?.key === 'field-stray' && world.day >= 93) {
      travelAction('contact', position)
      return
    }
    if (obstacle) return
    if (expedition?.encounter === 'active') {
      setMessage('獣が目の前にいます。まず離れるか鎮めるかを選んでください。')
      return
    }
    const here = world.tileMap.get(`${position.x},${position.y}`)
    const ahead = world.tileMap.get(`${next.x},${next.y}`)
    if (world.day >= 61 && ahead?.traversal === 'water') {
      setMessage(world.day >= 64 ? '小川です。向こう岸へ渡るにはアクションしてください。' : '小川の水面で足が止まりました。')
      return
    }
    if (world.day >= 63 && (here?.elevation ?? 0) !== (ahead?.elevation ?? 0)) {
      setMessage(world.day >= 64 ? '段差があります。斜面に向いてアクションしてください。' : '段差は斜面から登れそうです。')
      return
    }
    setPosition(next)
    if (world.day >= 92 && next.x >= 17 && (!expedition?.inside || position.x < 17)) travelAction('enter', next)
    if (world.day >= 92 && next.x < 17 && position.x >= 17) travelAction('return', next)
  }, [expedition, position, travelAction, world])

  const pickUp = useCallback((target: WorldObject) => {
    if (!user) {
      setMessage('拾うには、まず検証用の記録を始めてください。')
      return
    }
    fetch('/api/pickup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: target.key }) })
      .then(async response => ({ response, result: await response.json() as { error?: string } }))
      .then(({ response, result }) => {
        setMessage(response.ok ? `${target.label}を手に取りました。` : (result.error ?? '拾えませんでした。'))
        if (response.ok) {
          setInventory(current => current.some(item => item.key === target.key) ? current : [...current, { key: target.key, label: target.label, quantity: 1, firstPickedDay: world?.day ?? 5 }])
          setWorld(current => {
            if (!current) return current
            const objects = current.objects.filter(object => object.key !== target.key)
            const interactionTiles = new Map(current.interactionTiles)
            for (let y = 0; y < target.height; y += 1) {
              for (let x = 0; x < target.width; x += 1) interactionTiles.delete(`${target.x + x},${target.y + y}`)
            }
            return { ...current, objects, interactionTiles }
          })
        }
      })
      .catch(() => setMessage('拾ったものを記録できませんでした。'))
  }, [user, world])

  const placeItem = useCallback(() => {
    if (!user || !world || world.day < 6 || inventory.length === 0) return false
    const byPond = position.x >= 6 && position.x <= 9 && position.y >= 6 && position.y <= 9
    const item = world.day >= 38 && byPond ? inventory.find(entry => entry.key === 'item-reed')
      ?? inventory.find(entry => entry.key === 'item-lantern') ?? inventory[0]
      : world.day >= 29 ? inventory.find(entry => entry.key === 'item-field-bundle')
        ?? inventory.find(entry => entry.key === 'item-lantern') ?? inventory[0] : inventory[0]
    fetch('/api/place', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemKey: item.key, x: position.x, y: position.y }),
    }).then(async response => ({ response, result: await response.json() as { error?: string; message?: string } }))
      .then(({ response, result }) => {
        if (!response.ok) {
          setMessage(result.error ?? 'そこには置けません。')
          return
        }
        setMessage(result.message ?? `${item.label ?? item.key}を置きました。`)
        fetch('/api/inventory').then(inventoryResponse => inventoryResponse.ok ? inventoryResponse.json() : null).then(data => {
          if (data?.items) setInventory(data.items)
        }).catch(() => undefined)
        fetch('/api/world').then(result => result.ok ? result.json() : null).then(data => {
          if (data) setWorld(buildWorld(data))
        }).catch(() => undefined)
      }).catch(() => setMessage('置いたものを記録できませんでした。'))
    return true
  }, [inventory, position, user, world])

  const reclaimTrace = useCallback((target: WorldObject) => {
    if (!user) {
      setMessage('再取得には、まず検証用の記録を始めてください。')
      return
    }
    const traceId = Number(target.key.replace('trace-', ''))
    fetch('/api/reclaim-trace', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ traceId }),
    }).then(async response => ({ response, result: await response.json() as { error?: string; item?: { key: string; label: string; quantity: number } } }))
      .then(({ response, result }) => {
        if (!response.ok) {
          setMessage(result.error ?? 'その跡は再取得できません。')
          return
        }
        if (result.item) setInventory(current => [...current, { ...result.item!, firstPickedDay: world?.day ?? 10 }])
        setMessage(`${result.item?.label ?? '置いたもの'}を手に戻しました。`)
        fetch('/api/world').then(worldResponse => worldResponse.ok ? worldResponse.json() : null).then(data => {
          if (data) setWorld(buildWorld(data))
        }).catch(() => undefined)
      }).catch(() => setMessage('再取得を記録できませんでした。'))
  }, [user, world])

  const gardenAction = useCallback(() => {
    if (!user || !world || world.day < 17) return false
    fetch('/api/garden-action', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x: position.x, y: position.y }),
    }).then(async response => ({ response, result: await response.json() as { error?: string; message?: string; state?: string } }))
      .then(({ response, result }) => {
        setMessage(response.ok ? (result.message ?? '庭に変化がありました。') : (result.error ?? '庭では何も起きませんでした。'))
        if (!response.ok) return
        completeActivity('garden')
        const refreshWorld = () => fetch('/api/world').then(worldResponse => worldResponse.ok ? worldResponse.json() : null).then(data => {
          if (data) setWorld(buildWorld(data))
        }).catch(() => undefined)
        void refreshWorld()
        fetch('/api/inventory').then(inventoryResponse => inventoryResponse.ok ? inventoryResponse.json() : null).then(data => {
          if (data?.items) setInventory(data.items)
        }).catch(() => undefined)
        if (result.state === 'watered') window.setTimeout(refreshWorld, 91_000)
        if (world.day >= 45) refreshHabitatCare()
      }).catch(() => setMessage('庭の状態を記録できませんでした。'))
    return true
  }, [completeActivity, position, refreshHabitatCare, user, world])

  const performTool = useCallback((target: WorldObject) => {
    fetch('/api/tool-action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: target.key, x: position.x, y: position.y }) })
      .then(async response => ({ response, result: await response.json() as { error?: string; message?: string } }))
      .then(({ response, result }) => {
        setMessage(response.ok ? (result.message ?? '素材を取り出しました。') : (result.error ?? '道具を使えません。'))
        if (response.ok) {
          completeActivity('gathering')
          fetch('/api/inventory').then(inventoryResponse => inventoryResponse.ok ? inventoryResponse.json() : null).then(data => data?.items && setInventory(data.items)).catch(() => undefined)
        }
      })
      .catch(() => setMessage('道具の操作を記録できませんでした。'))
  }, [completeActivity, position])

  const harvestSource = useCallback((target: WorldObject) => {
    fetch('/api/source-action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: target.key, x: position.x, y: position.y }) })
      .then(async response => ({ response, result: await response.json() as { error?: string; message?: string } }))
      .then(({ response, result }) => {
        setMessage(response.ok ? (result.message ?? '実りを採りました。') : (result.error ?? 'そこからは採れません。'))
        if (response.ok) {
          completeActivity('gathering')
          fetch('/api/inventory').then(inventoryResponse => inventoryResponse.ok ? inventoryResponse.json() : null).then(data => data?.items && setInventory(data.items)).catch(() => undefined)
        }
      }).catch(() => setMessage('採取を記録できませんでした。'))
  }, [completeActivity, position])

  const craft = useCallback(() => {
    fetch('/api/craft', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x: position.x, y: position.y }) })
      .then(async response => ({ response, result: await response.json() as { error?: string; message?: string } }))
      .then(({ response, result }) => {
        setMessage(response.ok ? (result.message ?? '何かを作りました。') : (result.error ?? 'まだ作れません。'))
        if (response.ok) fetch('/api/inventory').then(inventoryResponse => inventoryResponse.ok ? inventoryResponse.json() : null).then(data => data?.items && setInventory(data.items)).catch(() => undefined)
      }).catch(() => setMessage('作ったものを記録できませんでした。'))
  }, [position])

  const fishingAction = useCallback((target: 'rod' | 'pond') => {
    if (!user) {
      setMessage('釣りには、まず検証用の記録を始めてください。')
      return
    }
    fetch('/api/fishing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, x: position.x, y: position.y }),
    }).then(async response => ({ response, result: await response.json() as { error?: string; message?: string; state?: 'idle' | 'cast' | 'caught'; observedHabitat?: string; lastReleaseHabitat?: string; bankSeen?: boolean; releasedCount?: number; comparedWaters?: boolean } }))
      .then(({ response, result }) => {
        setMessage(response.ok ? (result.message ?? '水面に変化がありました。') : (result.error ?? '釣りを続けられません。'))
        if (response.ok && result.state) setFishingState(result.state)
        if (response.ok && result.observedHabitat) setObservedHabitats(current => [...new Set([...current, result.observedHabitat!])])
        if (response.ok && result.lastReleaseHabitat) setLastReleaseHabitat(result.lastReleaseHabitat)
        if (response.ok && result.bankSeen !== undefined) setBankSeen(result.bankSeen)
        if (response.ok && result.releasedCount) completeActivity('fishing')
        if (response.ok && (result.observedHabitat || result.comparedWaters)) completeActivity('observation')
        if (response.ok && result.comparedWaters) setWatersCompared(true)
      })
      .catch(() => setMessage('釣りの状態を記録できませんでした。'))
  }, [completeActivity, position, user])

  const streamFishingAction = useCallback(() => {
    fetch('/api/stream-fishing', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x: position.x, y: position.y }) })
      .then(async response => ({ response, result: await response.json() as { error?: string; message?: string; state?: 'idle' | 'cast' | 'caught'; observed?: boolean; released?: boolean; revisited?: boolean } }))
      .then(({ response, result }) => {
        setMessage(response.ok ? result.message ?? '' : result.error ?? '魚影を見られません。')
        if (!response.ok) return
        if (result.state) setStreamFishingState(result.state)
        if (result.observed || result.revisited) completeActivity('observation')
        if (result.released) {
          completeActivity('fishing')
          fetch('/api/world').then(worldResponse => worldResponse.ok ? worldResponse.json() : null)
            .then(data => { if (data) setWorld(buildWorld(data)) }).catch(() => undefined)
        }
      }).catch(() => setMessage('小川の記録を残せませんでした。'))
  }, [completeActivity, position])

  const observeStreamDragonfly = useCallback(() => {
    fetch('/api/stream-dragonfly', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x: position.x, y: position.y }) })
      .then(async response => ({ response, result: await response.json() as { error?: string; message?: string; observed?: boolean; linked?: boolean; revisited?: boolean } }))
      .then(({ response, result }) => {
        setMessage(response.ok ? result.message ?? '' : result.error ?? 'トンボを見られません。')
        if (response.ok && (result.observed || result.linked || result.revisited)) completeActivity('observation')
      }).catch(() => setMessage('トンボの観察を記録できませんでした。'))
  }, [completeActivity, position])

  const observeMayfly = useCallback((key: 'stream-mayfly' | 'mayfly-trace') => {
    fetch('/api/field-observe', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, x: position.x, y: position.y }) })
      .then(async response => ({ response, result: await response.json() as { error?: string; message?: string; observed?: boolean } }))
      .then(({ response, result }) => {
        setMessage(response.ok ? result.message ?? '' : result.error ?? '観察できませんでした。')
        if (response.ok && result.observed) completeActivity('observation')
      }).catch(() => setMessage('観察を記録できませんでした。'))
  }, [completeActivity, position])

  const residentAction = useCallback((target: 'hill-resident' | 'stream-resident') => {
    fetch('/api/resident', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, x: position.x, y: position.y }) })
      .then(async response => ({ response, result: await response.json() as { error?: string; message?: string; gift?: boolean; exchange?: boolean } }))
      .then(({ response, result }) => {
        setMessage(response.ok ? result.message ?? '' : result.error ?? '住人と話せません。')
        if (!response.ok || (!result.gift && !result.exchange)) return
        completeActivity('gathering')
        fetch('/api/inventory').then(inventoryResponse => inventoryResponse.ok ? inventoryResponse.json() : null)
          .then(data => { if (data?.items) setInventory(data.items) }).catch(() => undefined)
      }).catch(() => setMessage('住人とのやりとりを記録できませんでした。'))
  }, [completeActivity, position])

  const observeSpring = useCallback(() => {
    fetch('/api/east-spring', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x: position.x, y: position.y }) })
      .then(async response => ({ response, result: await response.json() as { error?: string; message?: string; seen?: boolean; compared?: boolean } }))
      .then(({ response, result }) => {
        setMessage(response.ok ? result.message ?? '' : result.error ?? '泉の様子がわかりません。')
        if (response.ok && result.seen) { setEastSeen(true); completeActivity('observation') }
        if (response.ok && result.compared) setWatersCompared(true)
      }).catch(() => setMessage('泉の様子を記録できませんでした。'))
  }, [completeActivity, position])

  const observeEcology = useCallback((target: WorldObject) => {
    fetch('/api/ecology', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: target.key, x: position.x, y: position.y }) })
      .then(async response => ({ response, result: await response.json() as { error?: string; message?: string; observed?: boolean; firstSeen?: boolean; recordedToday?: boolean } }))
      .then(({ response, result }) => {
        setMessage(response.ok ? result.message ?? target.message : result.error ?? '様子がわかりません。')
        if (!response.ok) return
        completeActivity('observation')
        if (target.key === 'garden-visitor' && result.observed) setGardenVisitSeen(true)
        if (result.recordedToday) setTodayEcologyEvents(current => [...new Set([...current, target.key])])
        if (target.key === 'east-nest' && result.observed) fetch('/api/world')
          .then(worldResponse => worldResponse.ok ? worldResponse.json() : null)
          .then(data => { if (data) setWorld(buildWorld(data)) }).catch(() => undefined)
      }).catch(() => setMessage('観察を記録できませんでした。'))
  }, [completeActivity, position])

  const terrainAction = useCallback((action: 'climb' | 'cross') => {
    fetch('/api/terrain-action', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, direction, x: position.x, y: position.y }) })
      .then(async response => ({ response, result: await response.json() as { error?: string; message?: string; position?: Position } }))
      .then(({ response, result }) => {
        setMessage(response.ok ? result.message ?? '' : result.error ?? 'この地形を越えられません。')
        if (response.ok && result.position) setPosition(result.position)
      }).catch(() => setMessage('地形を越える操作を記録できませんでした。'))
  }, [direction, position])

  const insectAction = useCallback((target: 'grass' | 'meadow' | 'striped' | 'net' | 'flowers') => {
    fetch('/api/insects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, x: position.x, y: position.y }),
    }).then(async response => ({ response, result: await response.json() as {
      error?: string; message?: string; state?: 'free' | 'held'; released?: boolean; flowerTended?: boolean; flowerColor?: 'white' | 'yellow'
    } })).then(({ response, result }) => {
      setMessage(response.ok ? (result.message ?? '草むらに変化がありました。') : (result.error ?? '虫を見つけられません。'))
      if (response.ok && result.state) setInsectState(result.state)
      if (response.ok && result.released !== undefined) setInsectReleased(result.released)
      if (response.ok && result.flowerTended !== undefined) setFlowerTended(result.flowerTended)
      if (response.ok && result.flowerColor) setFlowerColor(result.flowerColor)
      if (response.ok && target === 'flowers' && world && world.day >= 45) refreshHabitatCare()
    }).catch(() => setMessage('虫の状態を記録できませんでした。'))
  }, [position, refreshHabitatCare, world])

  const shoreAction = useCallback(() => {
    fetch('/api/shore-observe', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x: position.x, y: position.y }) })
      .then(async response => ({ response, result: await response.json() as { error?: string; message?: string } }))
      .then(({ response, result }) => setMessage(response.ok ? result.message ?? '' : result.error ?? '様子がわかりません。'))
      .catch(() => setMessage('岸辺の様子を確かめられませんでした。'))
  }, [position])

  const act = useCallback(() => {
    if (!world) return
    const vector = directionVectors[direction]
    // Items do not block movement. Allow the same action to pick one up from
    // the tile under the observer or from the tile they are facing.
    const target = world.interactionTiles.get(`${position.x},${position.y}`)?.kind === 'item'
      ? world.interactionTiles.get(`${position.x},${position.y}`)
      : world.interactionTiles.get(`${position.x + vector.x},${position.y + vector.y}`)
    if (target?.kind === 'item') {
      pickUp(target)
      return
    }
    if (target?.kind === 'trace') {
      reclaimTrace(target)
      return
    }
    if (target?.kind === 'decoration') {
      setMessage(target.message)
      return
    }
    if (target?.key === 'garden-visitor') {
      if (position.x === target.x && position.y === target.y) gardenAction()
      else if (world.day >= 57) observeEcology(target)
      else setMessage(target.message)
      return
    }
    if (target?.key === 'fruit-visitor') {
      setMessage(target.message)
      return
    }
    if (target?.key === 'shore-creature' && world.day >= 39) {
      shoreAction()
      return
    }
    if (target?.key === 'east-spring' && world.day >= 48) {
      observeSpring()
      return
    }
    if (target?.key === 'stream-fish' && world.day >= 67) {
      streamFishingAction()
      return
    }
    if (target?.key === 'stream-dragonfly' && world.day >= 71) {
      observeStreamDragonfly()
      return
    }
    if ((target?.key === 'stream-mayfly' || target?.key === 'mayfly-trace') && world.day >= 86) {
      observeMayfly(target.key)
      return
    }
    if (target?.key === 'field-stray' && world.day >= 93) {
      travelAction('contact', position)
      return
    }
    if (target && (target.key === 'hill-resident' || target.key === 'stream-resident') && world.day >= 76) {
      residentAction(target.key)
      return
    }
    if (target && ['east-bird', 'east-nest', 'east-feather'].includes(target.key) && world.day >= 51) {
      observeEcology(target)
      return
    }
    if (target?.kind === 'resource') {
      if (world.day >= 25) performTool(target)
      else setMessage(target.message)
      return
    }
    if (target?.kind === 'source') {
      harvestSource(target)
      return
    }
    if (target?.key === 'fishing-rod') {
      fishingAction('rod')
      return
    }
    if (target?.key === 'pond' && world.day >= 8) {
      fishingAction('pond')
      return
    }
    if (target?.key === 'insect-grass') {
      insectAction('grass')
      return
    }
    if (target?.key === 'insect-meadow') {
      insectAction('meadow')
      return
    }
    if (target?.key === 'insect-striped') {
      insectAction('striped')
      return
    }
    if (target?.key === 'insect-net') {
      insectAction('net')
      return
    }
    if (target?.key === 'insect-flowers') {
      insectAction('flowers')
      return
    }
    if (target?.key === 'workbench') {
      if (world.day >= 28) craft()
      else setMessage(target.message)
      return
    }
    if (!target && world.day >= 64) {
      const here = world.tileMap.get(`${position.x},${position.y}`)
      const ahead = world.tileMap.get(`${position.x + vector.x},${position.y + vector.y}`)
      if (ahead?.traversal === 'water') {
        terrainAction('cross')
        return
      }
      if (here && ahead && here.elevation !== ahead.elevation &&
        (here.traversal === 'slope' || ahead.traversal === 'slope')) {
        terrainAction('climb')
        return
      }
    }
    if (!target && world.day >= 17) {
      const ground = world.groundTiles.find(tile => tile.x === position.x && tile.y === position.y)
      const holdingSeed = inventory.some(item => ['item-seed', 'item-berry', 'item-sprout'].includes(item.key) ||
        (world.day >= 79 && item.key === 'item-windseed'))
      const gardenTile = ground && ['tilled', 'planted', 'watered', 'grown'].includes(ground.kind)
      const holdingLantern = world.day >= 29 && inventory.some(item => item.key === 'item-lantern')
      const holdingFieldBundle = world.day >= 96 && inventory.some(item => item.key === 'item-field-bundle')
      const holdingReed = world.day >= 38 && inventory.some(item => item.key === 'item-reed')
      if (!gardenTile && (holdingLantern || holdingFieldBundle || holdingReed || ground?.kind === 'path' || (!holdingSeed && inventory.length > 0))) {
        if (placeItem()) return
      } else if (gardenAction()) return
    }
    if (!target && world.day >= 6 && inventory.length > 0 && placeItem()) return
    setMessage(target?.key === 'pond' && world.day >= 3
      ? '池の中を小さな魚影が泳いでいます。'
      : target?.message ?? '柔らかな土です。けれど、植えるものはまだありません。')
    if (target?.panel) setPanel(target.panel)
  }, [craft, direction, fishingAction, gardenAction, harvestSource, insectAction, inventory, observeEcology, observeMayfly, observeSpring, observeStreamDragonfly, performTool, pickUp, placeItem, position, reclaimTrace, residentAction, shoreAction, streamFishingAction, terrainAction, travelAction, world])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const controls: Partial<Record<string, Direction>> = {
        ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      }
      const nextDirection = controls[event.key]

      if (nextDirection) {
        event.preventDefault()
        const now = performance.now()
        if (event.repeat && now - lastKeyboardMove.current < 180) return
        lastKeyboardMove.current = now
        move(nextDirection)
      } else if (event.code === 'Space' && !event.repeat && !(event.target instanceof HTMLElement && event.target.closest('button, input, textarea, a'))) {
        event.preventDefault()
        act()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [act, move])

  // The garden can be wider than the screen, so walking must not leave the view behind.
  useEffect(() => {
    playerRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [position, ready, world])

  useEffect(() => {
    if (!panel) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanel(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [panel])

  useEffect(() => {
    Promise.all([
      fetch('/api/session').then(response => response.ok ? response.json() : { user: null }).catch(() => ({ user: null })),
      fetch('/api/diary').then(response => response.ok ? response.json() : null).catch(() => null),
      fetch('/api/world').then(response => response.ok ? response.json() : null).catch(() => null),
    ]).then(([session, history, worldData]) => {
      setUser(session.user)
      if (session.mode === 'day1' || session.mode === 'evolution') setMode(session.mode)

      if (history?.entries?.length) {
        setDiary(history.entries)
        writeCache(DIARY_CACHE, history.entries)
      } else {
        const kept = readCache<DiaryEntry[]>(DIARY_CACHE)
        if (kept?.length) setDiary(kept)
      }

      if (worldData) {
        setWorld(buildWorld(worldData))
        writeCache(WORLD_CACHE, worldData)
      } else {
        // The world is unreachable. Show the last one that arrived, read only.
        setOffline(true)
        const kept = readCache<WorldResponse>(WORLD_CACHE)
        if (kept) {
          setWorld(buildWorld(kept))
          setMessage('世界に手が届きません。これは、最後に見えていた景色です。')
        } else {
          setMessage('世界に手が届きません。しばらくしてから、また来てください。')
        }
      }

      if (session.user) {
        fetch('/api/save').then(response => response.ok ? response.json() : null).then(result => {
          if (result?.save?.position) setPosition(result.save.position)
          if (result?.save?.direction) setDirection(result.save.direction)
        }).finally(() => setReady(true))
      } else {
        setReady(true)
      }
    }).catch(() => setReady(true))
  }, [])

  const currentWorldDay = world?.day
  useEffect(() => {
    if (!currentWorldDay || currentWorldDay < 81 || offline) return
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      fetch('/api/world').then(response => response.ok ? response.json() as Promise<WorldResponse> : null)
        .then(data => {
          if (data) {
            setWorld(buildWorld(data))
            writeCache(WORLD_CACHE, data)
          }
        }).catch(() => undefined)
    }
    const timer = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [currentWorldDay, offline])

  useEffect(() => {
    if (!user || !world || world.day < 5) return
    fetch('/api/inventory').then(response => response.ok ? response.json() : null).then(result => {
      if (result?.items) setInventory(result.items)
    }).catch(() => undefined)
  }, [user, world])

  useEffect(() => {
    if (!user || !world || world.day < 8 || offline) return
    fetch('/api/fishing').then(response => response.ok ? response.json() : null).then(result => {
      if (result?.state) setFishingState(result.state)
      if (result?.observedHabitats) setObservedHabitats(result.observedHabitats)
      if (result?.lastReleaseHabitat) setLastReleaseHabitat(result.lastReleaseHabitat)
      if (result?.bankSeen !== undefined) setBankSeen(result.bankSeen)
    }).catch(() => undefined)
  }, [user, world, offline])

  useEffect(() => {
    if (!user || !world || world.day < 68 || offline) return
    fetch('/api/stream-fishing').then(response => response.ok ? response.json() : null).then(result => {
      if (result?.state) setStreamFishingState(result.state)
    }).catch(() => undefined)
  }, [user, world, offline])

  useEffect(() => {
    if (!user || !currentWorldDay || currentWorldDay < 92 || offline) return
    fetch('/api/expedition').then(response => response.ok ? response.json() : null)
      .then(result => { if (result?.expedition) setExpedition(result.expedition) }).catch(() => undefined)
  }, [user, currentWorldDay, offline])

  useEffect(() => {
    if (!user || !world || world.day < 45 || offline) return
    refreshHabitatCare()
  }, [user, world, offline, refreshHabitatCare])

  useEffect(() => {
    if (!user || !world || world.day < 48 || offline) return
    fetch('/api/east-spring').then(response => response.ok ? response.json() : null).then(result => {
      if (result?.seen) setEastSeen(true)
      if (result?.compared) setWatersCompared(true)
    }).catch(() => undefined)
  }, [user, world, offline])

  useEffect(() => {
    if (!user || !world || world.day < 56 || offline) return
    fetch('/api/ecology').then(response => response.ok ? response.json() : null).then(result => {
      if (result?.gardenSignals) setGardenSignals(result.gardenSignals)
      if (result?.gardenSeen) setGardenVisitSeen(true)
      if (result?.todayEvents) setTodayEcologyEvents(result.todayEvents)
    }).catch(() => undefined)
  }, [user, world, offline, eastSeen, flowerTended, habitatCare])

  useEffect(() => {
    if (!user || !world || world.day < 12 || offline) return
    fetch('/api/insects').then(response => response.ok ? response.json() : null).then(result => {
      if (result?.state) setInsectState(result.state)
      if (result?.released !== undefined) setInsectReleased(result.released)
      if (result?.flowerTended !== undefined) setFlowerTended(result.flowerTended)
      if (result?.flowerColor) setFlowerColor(result.flowerColor)
    }).catch(() => undefined)
  }, [user, world, offline])

  useEffect(() => {
    if (!user || !ready || offline) return
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      fetch('/api/save', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ position, direction, worldDay: world?.day ?? null }),
      }).catch(() => undefined)
    }, 500)
    return () => window.clearTimeout(saveTimer.current)
  }, [direction, position, user, ready, world, offline])

  const submitWish = async () => {
    setWishStatus('')
    const response = await fetch('/api/wishes', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: wish, publicConsent }),
    })
    const result = await response.json() as { error?: string; issueUrl?: string }
    if (!response.ok) return setWishStatus(result.error ?? '願いを届けられませんでした。')
    setWish('')
    setPublicConsent(false)
    setWishStatus(mode === 'production' ? '願いは、世界へ届きました。' : '検証用の願いを保存しました。')
  }

  const previewLogin = async () => {
    const response = await fetch('/api/preview-login', { method: 'POST' })
    if (response.ok) location.reload()
    else setMessage('検証用の記録を始められませんでした。')
  }

  const preview = mode !== 'production'
  const footing = world?.tileMap.get(`${position.x},${position.y}`)
  const footingName = footing?.kind === 'hill' ? '丘' : footing?.kind === 'slope' ? '斜面'
    : footing?.kind === 'forest' ? '林' : footing?.kind === 'stream' ? '小川' : '草地'
  const climate = world?.climate
  const visiblePhase = climate?.phase ?? dayPhase
  const phaseName = visiblePhase === 'morning' ? '朝' : visiblePhase === 'evening' ? '夕' : '夜'
  const weatherName = climate?.weather === 'rain' ? '雨' : climate?.weather === 'cloud' ? '曇り' : '晴れ'
  const seasonName = climate?.season === 'sprout' ? '芽吹き' : climate?.season === 'sun' ? '盛夏'
    : climate?.season === 'harvest' ? '実り' : climate?.season === 'frost' ? '霜' : null

  return (
    <main className={`game-shell ${captureMode ? 'capture-mode' : ''} ${climate ? 'climate-active' : ''} ${world?.day && world.day >= 46 ? `phase-${visiblePhase}` : ''} ${climate && world && world.day >= 83 ? `weather-${climate.weather}` : ''} ${climate?.season && world && world.day >= 84 ? `season-${climate.season}` : ''}`}>
      {preview && <div className="preview-banner">{mode === 'day1' ? 'DAY 1 保存版' : `進化テスト · DAY ${world?.day ?? '…'}`}</div>}
      <section className="world" aria-label={world ? `はじまりの庭 Day ${world.day}` : 'はじまりの庭'}>
        <nav className="world-actions" aria-label="世界の記録">
          <button onClick={() => setPanel('diary')} aria-label="創世日記">▤</button>
          {world?.day && world.day >= 5 && <button onClick={() => { setInventoryStatus(''); setPanel('inventory') }} aria-label="持ち物">▣</button>}
          {world?.day && world.day >= 81 && climate && <span className="climate-badge" aria-label={`世界時刻は日本時間${climate.hour}時、${phaseName}、${weatherName}${seasonName ? `、${seasonName}` : ''}`}>{climate.hour}時 · {phaseName} · {weatherName}{seasonName ? ` · ${seasonName}` : ''}</span>}
          {world?.day && world.day >= 46 && world.day < 81 && <button onClick={() => setDayPhase(current => current === 'morning' ? 'evening' : 'morning')} aria-label={`現在は${dayPhase === 'morning' ? '朝' : '夕'}。朝夕を切り替え`} title="朝夕を切り替え">{dayPhase === 'morning' ? '☀' : '☾'}</button>}
          {world?.day && world.day >= 50 && <button onClick={() => setPanel('choices')} aria-label="10分の遊び方を選ぶ">◈</button>}
          {world?.day && world.day >= 89 && <button onClick={() => {
            setPanel('field-guide')
            fetch('/api/field-guide').then(response => response.ok ? response.json() : null)
              .then(data => setFieldEntries(data?.entries ?? [])).catch(() => setFieldEntries([]))
          }} aria-label="発見した生き物の図鑑">▥</button>}
          <button onClick={() => setPanel('account')} aria-label="アカウント">●</button>
        </nav>
        {world && <div className="pixel-map" style={{ '--cols': world.width, '--rows': world.height } as CSSProperties}>
          {world.groundTiles.map(tile => {
            const { ux, uy } = world.isoUnits(tile.x + 0.5, tile.y + 0.5)
            const shade = (tile.x + tile.y) % 2 === 0 ? 'tile-light' : 'tile-dark'
            return (
              <div
                key={`tile-${tile.x}-${tile.y}`}
                className={`iso-tile ${tile.kind !== 'path' && tile.kind !== 'grass' ? `${tile.kind}-tile` : tile.path ? 'path-tile' : shade}`}
                style={{ '--ux': ux, '--uy': uy } as CSSProperties}
              />
            )
          })}

          <svg className="garden-fence" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polygon points={world.fencePoints} />
          </svg>

          {world.objects.map(object => {
            // Standing sprites hang from the front corner of their footprint; flat ones sit on its centre.
            const { ux, uy } = object.flat
              ? world.isoUnits(object.x + object.width / 2, object.y + object.height / 2)
              : world.isoUnits(object.x + object.width, object.y + object.height)
            return (
              <div
                key={object.key}
                className={`map-object ${object.sprite} ${object.flat ? 'is-flat' : ''} ${object.key === 'field-stray' && expedition?.calmed ? 'field-calmed' : ''} ${object.key === 'stream-dragonfly' && world.day >= 72 ? 'dragonfly-flight' : ''} ${object.key === 'stream-fish' ? `stream-${streamFishingState}` : ''} ${object.key === 'pond' && world.day >= 2 ? 'pond-awake' : ''} ${object.key === 'pond' && world.day >= 3 ? 'pond-fish' : ''} ${object.key === 'pond' && world.day >= 31 ? 'pond-shallows' : ''} ${object.key === 'pond' && world.day >= 32 ? 'pond-two-fish' : ''} ${object.key === 'pond' && world.day >= 34 ? 'pond-after-rain' : ''} ${object.key === 'pond' && world.day >= 43 ? 'pond-third-fish' : ''} ${object.key === 'pond' && fishingState === 'cast' ? 'pond-cast' : ''} ${object.key === 'pond' && fishingState === 'caught' ? 'pond-caught' : ''} ${object.key === 'insect-grass' && insectState === 'held' ? 'bug-held' : ''} ${object.key === 'insect-flowers' && (flowerTended || insectReleased) ? 'flower-attracted' : ''} ${object.key === 'insect-flowers' && world.day >= 36 ? `flower-${flowerColor}` : ''} ${object.key === 'shore-creature' && world.day >= 39 && Math.abs(position.x - object.x) + Math.abs(position.y - object.y) <= 1 ? position.y < object.y ? 'shore-calm' : 'shore-wary' : ''}`}
                style={{
                  '--ux': ux,
                  '--uy': uy,
                  '--object-width': object.width,
                  '--object-height': object.height,
                  zIndex: object.flat ? 3 : Math.round(uy * 100),
                } as CSSProperties}
                role="img"
                aria-label={object.key === 'pond' && world.day >= 43 ? '浅瀬、深場、池の縁に三つの魚影が泳ぐ池' : object.key === 'pond' && world.day >= 32 ? '浅瀬の細い魚影と深場の丸い魚影が泳ぐ池' : object.key === 'pond' && world.day >= 3 ? '魚影の泳ぐ池' : object.key === 'insect-flowers' && (flowerTended || insectReleased) ? '虫が集まる岸辺の花' : object.label}
              >
                <i /><i /><i />
                {object.key === 'pond' && world.day >= 32 && <span className="pond-deep-fish" aria-hidden="true" />}
                {object.key === 'pond' && world.day >= 43 && <span className="pond-bank-fish" aria-hidden="true" />}
                {object.key === 'pond' && <span className="fishing-float" aria-hidden="true" />}
                {object.kind === 'item' && <span className="map-item-label">{object.label}</span>}
              </div>
            )
          })}

          {ready && (() => {
            const { ux, uy } = world.isoUnits(position.x + 1, position.y + 1)
            return (
              <div
                ref={playerRef}
                className="player"
                style={{ '--ux': ux, '--uy': uy, zIndex: Math.round(uy * 100) + 1 } as CSSProperties}
                role="img"
                aria-label="あなた"
              ><div className={`player-sprite facing-${direction}`}><span /></div></div>
            )
          })()}
        </div>}

      </section>
      {/* Outside the world, so scrolling the garden never moves the hand away. */}
      <div className="hud">
        <div className="message-window" role="status" aria-live="polite"><p>{message || '\u00a0'}</p>{world?.day && world.day >= 62 && <p className="terrain-status">足元: {footingName} · 高さ{footing?.elevation ?? 0}</p>}{world?.day && world.day >= 92 && expedition && <p className="expedition-status">体力 {expedition.hp}/{expedition.maxHp} · {expedition.readiness ? '道に慣れた' : '旅のはじまり'}{expedition.calmed ? ' · 獣は落ち着いている' : ''}</p>}{world?.day && world.day >= 50 && activity && <p className="activity-status">{activities.find(choice => choice.key === activity)?.label} · {activityComplete ? '達成' : '選択中'}</p>}{expedition?.encounter === 'active' && <div className="encounter-options"><button onClick={() => travelAction('avoid', position)}>離れる</button>{world?.day && world.day >= 94 && <button onClick={() => travelAction('calm', position)}>鎮める</button>}</div>}</div>
        <Controls move={move} act={act} />
      </div>
      {panel && <div className="overlay" role="presentation" onMouseDown={event => event.target === event.currentTarget && setPanel(null)}>
          <section className="record-window" role="dialog" aria-modal="true" aria-label={panel === 'diary' ? '創世日記' : panel === 'wish' ? '願い事' : panel === 'inventory' ? '持ち物' : panel === 'choices' ? '今日の10分' : panel === 'field-guide' ? '発見した生き物の図鑑' : 'アカウント'}>
          <button className="close-button" onClick={() => setPanel(null)} aria-label="閉じる">×</button>
          {panel === 'diary' && <>
            <h1>創世日記</h1>
            {world?.day && world.day >= 98 && <div className="diary-filter">
              <p className="small-text">関心のあるものから、過去の変化を辿れます。</p>
              <div className="diary-themes">{diaryThemes.map(theme => <button key={theme.key}
                className={diaryTheme === theme.key ? 'selected' : ''}
                onClick={() => setDiaryTheme(theme.key)}>{theme.label}</button>)}</div>
              <input type="search" value={diaryQuery} onChange={event => setDiaryQuery(event.target.value)}
                placeholder="日記を検索" aria-label="創世日記を検索" />
            </div>}
            {diary.filter(entry => world?.day && world.day >= 98
              ? (diaryTheme === 'all' || diaryThemes.find(theme => theme.key === diaryTheme)!.pattern.test(entry.body ?? ''))
                && (diaryQuery.trim() === '' || `DAY ${entry.worldDay} ${entry.body ?? ''}`.includes(diaryQuery.trim()))
              : true).map(entry => <article className="diary-entry" key={entry.worldDay}>
              <p className="entry-meta">DAY {entry.worldDay}</p>
              {entry.screenshotUrl && <img src={entry.screenshotUrl} alt={`DAY ${entry.worldDay}の世界`} />}
              {entry.body ? <p>{entry.body}</p> : <p className="entry-silence">この日、神は何も創らなかった。</p>}
            </article>)}
          </>}
          {panel === 'wish' && <>
            <h1>願い事</h1>
            {!user ? <><p>願うには、名を預けてください。</p>{preview
              ? <button className="primary-button" onClick={previewLogin}>検証用の記録を始める</button>
              : <a className="primary-link" href="/api/auth/google">Googleでログイン</a>}</> : <>
              <textarea value={wish} onChange={event => setWish(event.target.value)} maxLength={280} placeholder="願いをひとつ" aria-label="願い事" />
              {preview ? <p className="small-text">この願いは検証環境にだけ保存され、公開されません。</p>
                : <label className="consent"><input type="checkbox" checked={publicConsent} onChange={event => setPublicConsent(event.target.checked)} /> この願いは公開GitHub Issueになります。誰でも読めることに同意します。</label>}
              <button className="primary-button" onClick={submitWish} disabled={!wish.trim() || (!preview && !publicConsent)}>願う</button>
              <p className="small-text">願えるのは7日間にひとつです。個人情報や秘密は書かないでください。</p>
              {wishStatus && <p role="status">{wishStatus}</p>}
            </>}
          </>}
          {panel === 'inventory' && <>
            <h1>持ち物</h1>
            {!user ? <p>持ち物を見るには、記録を始めてください。</p> : inventory.length === 0
              ? <p className="small-text">まだ、手に持っているものはありません。</p>
              : <ul className="inventory-list">{inventory.map(item => <li key={item.key}><span>{item.label ?? item.key}</span><strong>×{item.quantity}</strong></li>)}</ul>}
            {user && world && world.day >= 33 && <p className="small-text">池の観察記録: {observedHabitats.length
              ? observedHabitats.map(key => key === 'shallow' ? '浅瀬' : '深場').join('・') : 'まだありません。池の両側から観察できます。'}</p>}
            {user && world && world.day >= 44 && lastReleaseHabitat && <p className="small-text">最後に魚を戻した場所: {lastReleaseHabitat === 'shallow' ? '浅瀬' : '深場'}</p>}
            {user && world && world.day >= 43 && bankSeen && <p className="small-text">池の東の縁で、三つ目の魚影を見つけました。</p>}
            {user && world && world.day >= 45 && habitatCare && <p className="small-text">花と水の記録: DAY {habitatCare.preparedDay} に{habitatCare.flowerColor === 'yellow' ? '黄色' : '白色'}の花と庭を整えました。{habitatCare.revisited ? '次の訪問の気配が残っています。' : '次の訪問を待っています。'}</p>}
            {user && world && world.day >= 48 && <p className="small-text">東の泉: {eastSeen ? '観察済み' : '未観察'}。{watersCompared ? '庭の池との違いを記録しました。' : '池と泉の両方を訪ねると比較できます。'}</p>}
            {user && world && world.day >= 56 && gardenSignals && <p className="small-text">庭への訪問条件: 水{gardenSignals.water ? '✓' : '…'}・花{gardenSignals.flower ? '✓' : '…'}・泉{gardenSignals.spring ? '✓' : '…'}。{gardenSignals.ready ? '訪問者のそばで観察できます。' : 'そろうと訪問者の反応が変わります。'}</p>}
            {user && world && world.day >= 57 && gardenVisitSeen && <p className="small-text">庭の訪問者を捕まえずに見守りました。</p>}
            {user && world && world.day >= 59 && todayEcologyEvents.length > 0 && <p className="small-text">今日の観察: {todayEcologyEvents.length}種類</p>}
            {inventoryStatus && <p role="status">{inventoryStatus}</p>}
          </>}
          {panel === 'choices' && <>
            <h1>今日の10分</h1>
            <p>一つ選び、庭で実際に試しましょう。途中で選び直せます。</p>
            <div className="activity-choices">{activities.map(choice => <button key={choice.key}
              className={activity === choice.key ? 'selected' : ''}
              onClick={() => { setActivity(choice.key); setActivityComplete(false); setMessage(`${choice.label}: ${choice.hint}`); setPanel(null) }}>
              <strong>{choice.label}</strong><span>{choice.hint}</span>
            </button>)}</div>
            {activity && <p role="status">{activities.find(choice => choice.key === activity)?.label}: {activityComplete ? '今日の一歩を達成しました。' : '選択中です。'}</p>}
          </>}
          {panel === 'field-guide' && <>
            <h1>見つけた生き物</h1>
            {!user ? <p>記録を始めると、近くで見た生き物を読み返せます。</p>
              : fieldEntries.length === 0 ? <p>まだ記録はありません。小川の魚影や羽のある生き物を近くで見てみましょう。</p>
                : fieldEntries.map(entry => <article className="field-entry" key={entry.key}>
                  <h2>{entry.label}</h2>
                  <p className="entry-meta">記録した日: DAY {entry.firstSeenDay}</p>
                  <p>{entry.note}</p>
                  {entry.absent && <p className="field-absent">現在は確認されていない</p>}
                </article>)}
          </>}
          {panel === 'account' && <>
            <h1>記憶</h1>
            {user ? <><p>{user.name} の世界は、ここに残ります。</p><button className="primary-button" onClick={async () => { await fetch('/api/logout', { method: 'POST' }); location.reload() }}>ログアウト</button></>
              : <><p>名を預けると、旅の続きを残せます。</p>{preview
                ? <button className="primary-button" onClick={previewLogin}>検証用の記録を始める</button>
                : <a className="primary-link" href="/api/auth/google">Googleでログイン</a>}</>}
          </>}
        </section>
      </div>}
    </main>
  )
}

function Controls({ move, act }: { move: (direction: Direction) => void; act: () => void }) {
  return (
    <div className="controls">
      <div className="dpad" aria-label="方向ボタン">
        <button className="up" onClick={() => move('up')} aria-label="上へ移動">▲</button>
        <button className="left" onClick={() => move('left')} aria-label="左へ移動">◀</button>
        <i aria-hidden="true" />
        <button className="right" onClick={() => move('right')} aria-label="右へ移動">▶</button>
        <button className="down" onClick={() => move('down')} aria-label="下へ移動">▼</button>
      </div>
      <button className="action-button" onClick={act} aria-label="アクション"><span /></button>
    </div>
  )
}

export default App
