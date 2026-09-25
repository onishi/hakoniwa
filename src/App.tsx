import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'

type Position = { x: number; y: number }
type Direction = 'up' | 'down' | 'left' | 'right'
type Panel = 'diary' | 'wish' | 'account' | null
type DiaryEntry = { worldDay: number; body: string; screenshotUrl: string | null }
type SessionUser = { name: string; avatarUrl: string | null }

type WorldObject = {
  key: string
  x: number
  y: number
  width?: number
  height?: number
  className: string
  message: string
  label: string
  panel?: Exclude<Panel, null>
  /** Flat ground-level features (no standing silhouette) sit in the ground layer instead of the depth-sorted layer. */
  flat?: boolean
}

const MAP_WIDTH = 12
const MAP_HEIGHT = 12
const WALK_MIN = 1
const WALK_MAX_X = MAP_WIDTH - 2
const WALK_MAX_Y = MAP_HEIGHT - 2

const objects: WorldObject[] = [
  { key: 'tree', x: 3, y: 3, className: 'map-tree', message: '世界で最初の木。葉の間で、風が眠っています。', label: 'はじまりの木' },
  { key: 'house', x: 7, y: 2, width: 2, height: 2, className: 'map-house', message: '小さな家です。中には、まだ誰もいません。', label: '小さな家' },
  { key: 'well', x: 5, y: 6, className: 'map-well', message: '古い井戸です。水の音はしません。', label: '古い井戸' },
  { key: 'wish-board', x: 2, y: 8, className: 'map-wish-board', message: '願いを、ひとつだけ。', label: '願いの掲示板', panel: 'wish' },
  { key: 'pond', x: 7, y: 7, width: 2, height: 2, className: 'map-pond', message: '底はまだ見えません。生き物の気配はありません。', label: '静かな池', flat: true },
]

const occupiedTiles = new Map<string, WorldObject>()

for (const object of objects) {
  for (let y = 0; y < (object.height ?? 1); y += 1) {
    for (let x = 0; x < (object.width ?? 1); x += 1) {
      occupiedTiles.set(`${object.x + x},${object.y + y}`, object)
    }
  }
}

const pathTileKeys = new Set<string>()
for (let x = WALK_MIN; x <= WALK_MAX_X; x += 1) pathTileKeys.add(`${x},6`)
for (let y = WALK_MIN; y <= WALK_MAX_Y; y += 1) pathTileKeys.add(`5,${y}`)

const groundTiles: (Position & { path: boolean })[] = []
for (let y = 0; y < MAP_HEIGHT; y += 1) {
  for (let x = 0; x < MAP_WIDTH; x += 1) {
    groundTiles.push({ x, y, path: pathTileKeys.has(`${x},${y}`) })
  }
}

// Isometric (2:1 diamond) projection: screen offset in half-tile units from the map's left corner.
const isoUnits = (gx: number, gy: number) => ({ ux: gx - gy + MAP_HEIGHT, uy: gx + gy })

const isoSpan = MAP_WIDTH + MAP_HEIGHT
const isoPercent = (gx: number, gy: number) => {
  const { ux, uy } = isoUnits(gx, gy)
  return { x: (ux / isoSpan) * 100, y: (uy / isoSpan) * 100 }
}

// The fence traces the outer edge of the walkable tiles, so it marks exactly where movement stops.
const fenceCorners = [
  isoPercent(WALK_MIN, WALK_MIN),
  isoPercent(WALK_MAX_X + 1, WALK_MIN),
  isoPercent(WALK_MAX_X + 1, WALK_MAX_Y + 1),
  isoPercent(WALK_MIN, WALK_MAX_Y + 1),
]
const toPoints = (points: { x: number; y: number }[]) => points.map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')

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
  const [diary, setDiary] = useState<DiaryEntry[]>([
    { worldDay: 1, body: '土と木と池を創りました。あなたが来てくれて、うれしい。', screenshotUrl: null },
  ])
  const [wish, setWish] = useState('')
  const [wishStatus, setWishStatus] = useState('')
  const [publicConsent, setPublicConsent] = useState(false)
  const [ready, setReady] = useState(false)
  const saveTimer = useRef<number | undefined>(undefined)
  const lastKeyboardMove = useRef(0)
  const captureMode = new URLSearchParams(location.search).has('capture')

  const move = useCallback((nextDirection: Direction) => {
    const vector = directionVectors[nextDirection]
    setDirection(nextDirection)
    setPosition(current => {
      const next = { x: current.x + vector.x, y: current.y + vector.y }
      const outsideMap = next.x < WALK_MIN || next.x > WALK_MAX_X || next.y < WALK_MIN || next.y > WALK_MAX_Y

      if (outsideMap || occupiedTiles.has(`${next.x},${next.y}`)) return current
      return next
    })
  }, [])

  const act = useCallback(() => {
    const vector = directionVectors[direction]
    const target = occupiedTiles.get(`${position.x + vector.x},${position.y + vector.y}`)
    setMessage(target?.message ?? '柔らかな土です。けれど、植えるものはまだありません。')
    if (target?.panel) setPanel(target.panel)
  }, [direction, position])

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
      fetch('/api/session').then(response => response.ok ? response.json() : { user: null }),
      fetch('/api/diary').then(response => response.ok ? response.json() : { entries: [] }),
    ]).then(([session, history]) => {
      setUser(session.user)
      if (history.entries?.length) setDiary(history.entries)
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
    if (!user || !ready) return
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      fetch('/api/save', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ position, direction, worldDay: 1 }) }).catch(() => undefined)
    }, 500)
    return () => window.clearTimeout(saveTimer.current)
  }, [direction, position, user, ready])

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
    setWishStatus('願いは、世界へ届きました。')
  }

  return (
    <main className={`game-shell ${captureMode ? 'capture-mode' : ''}`}>
      <section className="world" aria-label="はじまりの庭 Day 1">
        <nav className="world-actions" aria-label="世界の記録">
          <button onClick={() => setPanel('diary')} aria-label="創世日記">▤</button>
          <button onClick={() => setPanel('account')} aria-label="アカウント">●</button>
        </nav>
        <div className="pixel-map" style={{ '--cols': MAP_WIDTH, '--rows': MAP_HEIGHT } as CSSProperties}>
          {groundTiles.map(tile => {
            const { ux, uy } = isoUnits(tile.x + 0.5, tile.y + 0.5)
            const shade = (tile.x + tile.y) % 2 === 0 ? 'tile-light' : 'tile-dark'
            return (
              <div
                key={`tile-${tile.x}-${tile.y}`}
                className={`iso-tile ${tile.path ? 'path-tile' : shade}`}
                style={{ '--ux': ux, '--uy': uy } as CSSProperties}
              />
            )
          })}

          <svg className="garden-fence" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polygon points={toPoints(fenceCorners)} />
          </svg>

          {objects.map(object => {
            const width = object.width ?? 1
            const height = object.height ?? 1
            // Standing sprites hang from the front corner of their footprint; flat ones sit on its centre.
            const { ux, uy } = object.flat
              ? isoUnits(object.x + width / 2, object.y + height / 2)
              : isoUnits(object.x + width, object.y + height)
            return (
              <div
                key={object.key}
                className={`map-object ${object.className} ${object.flat ? 'is-flat' : ''}`}
                style={{
                  '--ux': ux,
                  '--uy': uy,
                  '--object-width': width,
                  '--object-height': height,
                  zIndex: object.flat ? 3 : Math.round(uy * 100),
                } as CSSProperties}
                role="img"
                aria-label={object.label}
              ><i /><i /><i /></div>
            )
          })}

          {ready && (() => {
            const { ux, uy } = isoUnits(position.x + 1, position.y + 1)
            return (
              <div
                className="player"
                style={{ '--ux': ux, '--uy': uy, zIndex: Math.round(uy * 100) + 1 } as CSSProperties}
                role="img"
                aria-label="あなた"
              ><div className={`player-sprite facing-${direction}`}><span /></div></div>
            )
          })()}
        </div>

        <div className="hud">
          <div className="message-window" role="status" aria-live="polite"><p>{message || '\u00a0'}</p></div>
          <Controls move={move} act={act} />
        </div>
      </section>
      {panel && <div className="overlay" role="presentation" onMouseDown={event => event.target === event.currentTarget && setPanel(null)}>
        <section className="record-window" role="dialog" aria-modal="true" aria-label={panel === 'diary' ? '創世日記' : panel === 'wish' ? '願い事' : 'アカウント'}>
          <button className="close-button" onClick={() => setPanel(null)} aria-label="閉じる">×</button>
          {panel === 'diary' && <>
            <h1>創世日記</h1>
            {diary.map(entry => <article className="diary-entry" key={entry.worldDay}>
              <p className="entry-meta">DAY {entry.worldDay}</p>
              {entry.screenshotUrl && <img src={entry.screenshotUrl} alt={`DAY ${entry.worldDay}の世界`} />}
              <p>{entry.body}</p>
            </article>)}
          </>}
          {panel === 'wish' && <>
            <h1>願い事</h1>
            {!user ? <><p>願うには、名を預けてください。</p><a className="primary-link" href="/api/auth/google">Googleでログイン</a></> : <>
              <textarea value={wish} onChange={event => setWish(event.target.value)} maxLength={280} placeholder="願いをひとつ" aria-label="願い事" />
              <label className="consent"><input type="checkbox" checked={publicConsent} onChange={event => setPublicConsent(event.target.checked)} /> この願いは公開GitHub Issueになります。誰でも読めることに同意します。</label>
              <button className="primary-button" onClick={submitWish} disabled={!wish.trim() || !publicConsent}>願う</button>
              <p className="small-text">願えるのは7日間にひとつです。個人情報や秘密は書かないでください。</p>
              {wishStatus && <p role="status">{wishStatus}</p>}
            </>}
          </>}
          {panel === 'account' && <>
            <h1>記憶</h1>
            {user ? <><p>{user.name} の世界は、ここに残ります。</p><button className="primary-button" onClick={async () => { await fetch('/api/logout', { method: 'POST' }); location.reload() }}>ログアウト</button></>
              : <><p>名を預けると、旅の続きを残せます。</p><a className="primary-link" href="/api/auth/google">Googleでログイン</a></>}
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
