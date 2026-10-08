import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'

type Position = { x: number; y: number }
type Direction = 'up' | 'down' | 'left' | 'right'
type Panel = 'diary' | 'wish' | 'account' | 'inventory' | null
/** A day the god stayed silent still has an entry; its body is simply missing. */
type DiaryEntry = { worldDay: number; body: string | null; screenshotUrl: string | null }
type SessionUser = { name: string; avatarUrl: string | null }
type AppMode = 'production' | 'day1' | 'evolution'

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

type WorldTile = { x: number; y: number; kind: string }

type WorldResponse = {
  worldDay: number
  oracle: string | null
  map: { width: number; height: number }
  entities: WorldObject[]
  tiles: WorldTile[]
}

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
  width: number
  height: number
  walkMaxX: number
  walkMaxY: number
  objects: WorldObject[]
  occupiedTiles: Map<string, WorldObject>
  interactionTiles: Map<string, WorldObject>
  groundTiles: (Position & { path: boolean; kind: string })[]
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
        interactionTiles.set(key, object)
        if (object.blocks) occupiedTiles.set(key, object)
      }
    }
  }

  const pathTileKeys = new Set(data.tiles.filter(tile => tile.kind === 'path').map(tile => `${tile.x},${tile.y}`))
  const groundTiles: (Position & { path: boolean; kind: string })[] = []
  const tileKinds = new Map(data.tiles.map(tile => [`${tile.x},${tile.y}`, tile.kind]))
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      groundTiles.push({ x, y, path: pathTileKeys.has(`${x},${y}`), kind: tileKinds.get(`${x},${y}`) ?? 'grass' })
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
    width,
    height,
    walkMaxX,
    walkMaxY,
    objects: data.entities,
    occupiedTiles,
    interactionTiles,
    groundTiles,
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
  const [wish, setWish] = useState('')
  const [wishStatus, setWishStatus] = useState('')
  const [publicConsent, setPublicConsent] = useState(false)
  const [ready, setReady] = useState(false)
  const [world, setWorld] = useState<World | null>(null)
  const [inventory, setInventory] = useState<{ key: string; label?: string; quantity: number; firstPickedDay: number }[]>([])
  const [inventoryStatus, setInventoryStatus] = useState('')
  const [fishingState, setFishingState] = useState<'idle' | 'cast' | 'caught'>('idle')
  const [insectState, setInsectState] = useState<'free' | 'held'>('free')
  const [insectReleased, setInsectReleased] = useState(false)
  const [flowerTended, setFlowerTended] = useState(false)
  /** The world came from the cache, so nothing this visit does is written back. */
  const [offline, setOffline] = useState(false)
  const saveTimer = useRef<number | undefined>(undefined)
  const lastKeyboardMove = useRef(0)
  const playerRef = useRef<HTMLDivElement | null>(null)
  const captureMode = new URLSearchParams(location.search).has('capture')

  const move = useCallback((nextDirection: Direction) => {
    if (!world) return
    const vector = directionVectors[nextDirection]
    setDirection(nextDirection)
    setPosition(current => {
      const next = { x: current.x + vector.x, y: current.y + vector.y }
      const outsideMap = next.x < WALK_MIN || next.x > world.walkMaxX || next.y < WALK_MIN || next.y > world.walkMaxY

      if (outsideMap || world.occupiedTiles.has(`${next.x},${next.y}`)) return current
      return next
    })
  }, [world])

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
    const item = inventory[0]
    fetch('/api/place', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemKey: item.key, x: position.x, y: position.y }),
    }).then(async response => ({ response, result: await response.json() as { error?: string } }))
      .then(({ response, result }) => {
        if (!response.ok) {
          setMessage(result.error ?? 'そこには置けません。')
          return
        }
        setInventory(current => current.slice(1))
        setMessage(`${item.label ?? item.key}を置きました。`)
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
        const refreshWorld = () => fetch('/api/world').then(worldResponse => worldResponse.ok ? worldResponse.json() : null).then(data => {
          if (data) setWorld(buildWorld(data))
        }).catch(() => undefined)
        void refreshWorld()
        fetch('/api/inventory').then(inventoryResponse => inventoryResponse.ok ? inventoryResponse.json() : null).then(data => {
          if (data?.items) setInventory(data.items)
        }).catch(() => undefined)
        if (result.state === 'watered') window.setTimeout(refreshWorld, 91_000)
      }).catch(() => setMessage('庭の状態を記録できませんでした。'))
    return true
  }, [position, user, world])

  const performTool = useCallback((target: WorldObject) => {
    fetch('/api/tool-action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: target.key }) })
      .then(async response => ({ response, result: await response.json() as { error?: string; message?: string } }))
      .then(({ response, result }) => setMessage(response.ok ? (result.message ?? '素材を取り出しました。') : (result.error ?? '道具を使えません。')))
      .catch(() => setMessage('道具の操作を記録できませんでした。'))
  }, [])

  const harvestSource = useCallback((target: WorldObject) => {
    fetch('/api/source-action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: target.key, x: position.x, y: position.y }) })
      .then(async response => ({ response, result: await response.json() as { error?: string; message?: string } }))
      .then(({ response, result }) => {
        setMessage(response.ok ? (result.message ?? '実りを採りました。') : (result.error ?? 'そこからは採れません。'))
        if (response.ok) fetch('/api/inventory').then(inventoryResponse => inventoryResponse.ok ? inventoryResponse.json() : null).then(data => data?.items && setInventory(data.items)).catch(() => undefined)
      }).catch(() => setMessage('採取を記録できませんでした。'))
  }, [position])

  const craft = useCallback(() => {
    fetch('/api/craft', { method: 'POST' })
      .then(async response => ({ response, result: await response.json() as { error?: string; message?: string } }))
      .then(({ response, result }) => {
        setMessage(response.ok ? (result.message ?? '何かを作りました。') : (result.error ?? 'まだ作れません。'))
        if (response.ok) fetch('/api/inventory').then(inventoryResponse => inventoryResponse.ok ? inventoryResponse.json() : null).then(data => data?.items && setInventory(data.items)).catch(() => undefined)
      }).catch(() => setMessage('作ったものを記録できませんでした。'))
  }, [])

  const fishingAction = useCallback((target: 'rod' | 'pond') => {
    if (!user) {
      setMessage('釣りには、まず検証用の記録を始めてください。')
      return
    }
    fetch('/api/fishing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, x: position.x, y: position.y }),
    }).then(async response => ({ response, result: await response.json() as { error?: string; message?: string; state?: 'idle' | 'cast' | 'caught' } }))
      .then(({ response, result }) => {
        setMessage(response.ok ? (result.message ?? '水面に変化がありました。') : (result.error ?? '釣りを続けられません。'))
        if (response.ok && result.state) setFishingState(result.state)
      })
      .catch(() => setMessage('釣りの状態を記録できませんでした。'))
  }, [position, user])

  const insectAction = useCallback((target: 'grass' | 'net' | 'flowers') => {
    fetch('/api/insects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, x: position.x, y: position.y }),
    }).then(async response => ({ response, result: await response.json() as {
      error?: string; message?: string; state?: 'free' | 'held'; released?: boolean; flowerTended?: boolean
    } })).then(({ response, result }) => {
      setMessage(response.ok ? (result.message ?? '草むらに変化がありました。') : (result.error ?? '虫を見つけられません。'))
      if (response.ok && result.state) setInsectState(result.state)
      if (response.ok && result.released !== undefined) setInsectReleased(result.released)
      if (response.ok && result.flowerTended !== undefined) setFlowerTended(result.flowerTended)
    }).catch(() => setMessage('虫の状態を記録できませんでした。'))
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
    if (target?.kind === 'resource') {
      performTool(target)
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
    if (target?.key === 'insect-net') {
      insectAction('net')
      return
    }
    if (target?.key === 'insect-flowers') {
      insectAction('flowers')
      return
    }
    if (target?.key === 'house' && world.day >= 35) {
      craft()
      return
    }
    if (!target && world.day >= 17) {
      const ground = world.groundTiles.find(tile => tile.x === position.x && tile.y === position.y)
      const holdingSeed = inventory.some(item => ['item-seed', 'item-berry', 'item-sprout'].includes(item.key))
      const gardenTile = ground && ['tilled', 'planted', 'watered', 'grown'].includes(ground.kind)
      if (!gardenTile && (ground?.kind === 'path' || (!holdingSeed && inventory.length > 0))) {
        if (placeItem()) return
      } else if (gardenAction()) return
    }
    if (!target && world.day >= 6 && inventory.length > 0 && placeItem()) return
    setMessage(target?.key === 'pond' && world.day >= 3
      ? '池の中を小さな魚影が泳いでいます。'
      : target?.message ?? '柔らかな土です。けれど、植えるものはまだありません。')
    if (target?.panel) setPanel(target.panel)
  }, [craft, direction, fishingAction, gardenAction, harvestSource, insectAction, inventory, performTool, pickUp, placeItem, position, reclaimTrace, world])

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
      } else if (event.code === 'Space' && !event.repeat) {
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
    }).catch(() => undefined)
  }, [user, world, offline])

  useEffect(() => {
    if (!user || !world || world.day < 12 || offline) return
    fetch('/api/insects').then(response => response.ok ? response.json() : null).then(result => {
      if (result?.state) setInsectState(result.state)
      if (result?.released !== undefined) setInsectReleased(result.released)
      if (result?.flowerTended !== undefined) setFlowerTended(result.flowerTended)
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

  return (
    <main className={`game-shell ${captureMode ? 'capture-mode' : ''}`}>
      {preview && <div className="preview-banner">{mode === 'day1' ? 'DAY 1 保存版' : `進化テスト · DAY ${world?.day ?? '…'}`}</div>}
      <section className="world" aria-label={world ? `はじまりの庭 Day ${world.day}` : 'はじまりの庭'}>
        <nav className="world-actions" aria-label="世界の記録">
          <button onClick={() => setPanel('diary')} aria-label="創世日記">▤</button>
          {world?.day && world.day >= 5 && <button onClick={() => { setInventoryStatus(''); setPanel('inventory') }} aria-label="持ち物">▣</button>}
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
                className={`map-object ${object.sprite} ${object.flat ? 'is-flat' : ''} ${object.key === 'pond' && world.day >= 2 ? 'pond-awake' : ''} ${object.key === 'pond' && world.day >= 3 ? 'pond-fish' : ''} ${object.key === 'pond' && fishingState === 'cast' ? 'pond-cast' : ''} ${object.key === 'pond' && fishingState === 'caught' ? 'pond-caught' : ''} ${object.key === 'insect-grass' && insectState === 'held' ? 'bug-held' : ''} ${object.key === 'insect-flowers' && (flowerTended || insectReleased) ? 'flower-attracted' : ''}`}
                style={{
                  '--ux': ux,
                  '--uy': uy,
                  '--object-width': object.width,
                  '--object-height': object.height,
                  zIndex: object.flat ? 3 : Math.round(uy * 100),
                } as CSSProperties}
                role="img"
                aria-label={object.key === 'pond' && world.day >= 3 ? '魚影の泳ぐ池' : object.key === 'insect-flowers' && (flowerTended || insectReleased) ? '虫が集まる岸辺の花' : object.label}
              >
                <i /><i /><i />
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
        <div className="message-window" role="status" aria-live="polite"><p>{message || '\u00a0'}</p></div>
        <Controls move={move} act={act} />
      </div>
      {panel && <div className="overlay" role="presentation" onMouseDown={event => event.target === event.currentTarget && setPanel(null)}>
          <section className="record-window" role="dialog" aria-modal="true" aria-label={panel === 'diary' ? '創世日記' : panel === 'wish' ? '願い事' : panel === 'inventory' ? '持ち物' : 'アカウント'}>
          <button className="close-button" onClick={() => setPanel(null)} aria-label="閉じる">×</button>
          {panel === 'diary' && <>
            <h1>創世日記</h1>
            {diary.map(entry => <article className="diary-entry" key={entry.worldDay}>
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
            {inventoryStatus && <p role="status">{inventoryStatus}</p>}
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
