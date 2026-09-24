import { useCallback, useEffect, useState, type CSSProperties } from 'react'

type Position = { x: number; y: number }
type Direction = 'up' | 'down' | 'left' | 'right'

type WorldObject = {
  key: string
  x: number
  y: number
  width?: number
  height?: number
  className: string
  message: string
  label: string
}

const MAP_WIDTH = 16
const MAP_HEIGHT = 10

const objects: WorldObject[] = [
  { key: 'tree', x: 4, y: 3, className: 'map-tree', message: '世界で最初の木。葉の間で、風が眠っています。', label: 'はじまりの木' },
  { key: 'house', x: 11, y: 3, width: 2, height: 2, className: 'map-house', message: '小さな家です。中には、まだ誰もいません。', label: '小さな家' },
  { key: 'well', x: 7, y: 5, className: 'map-well', message: '古い井戸です。水の音はしません。', label: '古い井戸' },
  { key: 'pond', x: 12, y: 7, width: 3, height: 2, className: 'map-pond', message: '底はまだ見えません。生き物の気配はありません。', label: '静かな池' },
]

const occupiedTiles = new Map<string, WorldObject>()

for (const object of objects) {
  for (let y = 0; y < (object.height ?? 1); y += 1) {
    for (let x = 0; x < (object.width ?? 1); x += 1) {
      occupiedTiles.set(`${object.x + x},${object.y + y}`, object)
    }
  }
}

const directionVectors: Record<Direction, Position> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

function App() {
  const [position, setPosition] = useState<Position>({ x: 8, y: 8 })
  const [direction, setDirection] = useState<Direction>('up')
  const [message, setMessage] = useState('')

  const move = useCallback((nextDirection: Direction) => {
    const vector = directionVectors[nextDirection]
    setDirection(nextDirection)
    setPosition(current => {
      const next = { x: current.x + vector.x, y: current.y + vector.y }
      const outsideMap = next.x < 1 || next.x > MAP_WIDTH - 2 || next.y < 1 || next.y > MAP_HEIGHT - 2

      if (outsideMap || occupiedTiles.has(`${next.x},${next.y}`)) return current
      return next
    })
  }, [])

  const act = useCallback(() => {
    const vector = directionVectors[direction]
    const target = occupiedTiles.get(`${position.x + vector.x},${position.y + vector.y}`)
    setMessage(target?.message ?? '柔らかな土です。けれど、植えるものはまだありません。')
  }, [direction, position])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const controls: Partial<Record<string, Direction>> = {
        ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      }
      const nextDirection = controls[event.key]

      if (nextDirection) {
        event.preventDefault()
        move(nextDirection)
      } else if (event.code === 'Space') {
        event.preventDefault()
        act()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [act, move])

  return (
    <main className="game-shell">
      <section className="world" aria-label="はじまりの庭 Day 1">
        <div className="pixel-map" style={{ '--cols': MAP_WIDTH, '--rows': MAP_HEIGHT } as CSSProperties}>
          <div className="path path-horizontal" />
          <div className="path path-vertical" />
          <div className="fence fence-top" />
          <div className="fence fence-bottom" />
          <div className="fence fence-left" />
          <div className="fence fence-right" />

          {objects.map(object => (
            <div
              key={object.key}
              className={`map-object ${object.className}`}
              style={{
                '--x': object.x,
                '--y': object.y,
                '--object-width': object.width ?? 1,
                '--object-height': object.height ?? 1,
              } as CSSProperties}
              role="img"
              aria-label={object.label}
            />
          ))}

          <div
            className={`player facing-${direction}`}
            style={{ '--x': position.x, '--y': position.y } as CSSProperties}
            role="img"
            aria-label="あなた"
          ><span /></div>
        </div>

        <div className="message-window" role="status" aria-live="polite"><p>{message || '\u00a0'}</p></div>
        <Controls move={move} act={act} />
      </section>
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
