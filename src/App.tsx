import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { BookOpen, Home, Leaf, MessageCircleHeart, Search, X } from 'lucide-react'

type Panel = 'world' | 'chronicle' | 'wishes' | 'field-guide' | 'garden'
type Position = { x: number; y: number }

const MAP_WIDTH = 16
const MAP_HEIGHT = 10

const wishes = ['いつか海を見てみたい', '庭に蝶が来ますように', 'この卵が、無事に孵りますように']
const chronicle = [
  { day: 1, god: 'CLAUDE', title: 'はじまり', text: '小さな村と一本の木、静かな池が生まれました。' },
  { day: 2, god: 'CODEX', title: '道', text: '家々を結ぶため、土の道が世界に引かれました。' },
  { day: 3, god: 'CLAUDE', title: '願いの木', text: '声の届かない者たちのため、願いを結ぶ木が育ちました。' },
]

const objects = [
  { key: 'wish-tree', label: '願いの木', emoji: '♣', x: 3, y: 2, className: 'map-tree wishing-tree' },
  { key: 'house', label: '小さな家', emoji: '', x: 11, y: 2, className: 'map-house' },
  { key: 'pond', label: '静かな池', emoji: '', x: 12, y: 6, className: 'map-pond' },
  { key: 'well', label: '古い井戸', emoji: '●', x: 7, y: 5, className: 'map-well' },
] as const

const blocked = new Set(objects.map(({ x, y }) => `${x},${y}`))

function App() {
  const [panel, setPanel] = useState<Panel>('world')
  const [announcement, setAnnouncement] = useState(true)
  const [wish, setWish] = useState(() => localStorage.getItem('hakoniwa-wish') ?? '')
  const [sent, setSent] = useState(() => Boolean(localStorage.getItem('hakoniwa-wish')))
  const [position, setPosition] = useState<Position>({ x: 8, y: 7 })
  const [message, setMessage] = useState('矢印キーか画面のボタンで、村を歩けます。')

  const move = (dx: number, dy: number) => {
    setPosition(current => {
      const next = {
        x: Math.max(1, Math.min(MAP_WIDTH - 2, current.x + dx)),
        y: Math.max(1, Math.min(MAP_HEIGHT - 2, current.y + dy)),
      }
      if (blocked.has(`${next.x},${next.y}`)) {
        const nearby = objects.find(object => object.x === next.x && object.y === next.y)
        setMessage(nearby ? `${nearby.label}があります。調べてみましょう。` : 'ここは通れません。')
        return current
      }
      setMessage('草が、足もとで小さく鳴りました。')
      return next
    })
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (panel !== 'world') return
      const directions: Record<string, [number, number]> = {
        ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1],
        ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0],
      }
      const direction = directions[event.key]
      if (direction) {
        event.preventDefault()
        move(...direction)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [panel])

  const inspect = () => {
    const nearby = objects.find(object => Math.abs(object.x - position.x) + Math.abs(object.y - position.y) === 1)
    if (!nearby) {
      setMessage('風が草を揺らしています。遠くで水の音がします。')
      return
    }
    const copy: Record<string, string> = {
      'wish-tree': '枝には、あなたが書いていない願いが揺れています。',
      house: 'まだ誰の名もない、小さな家です。',
      pond: '底は見えません。水面にも、あなたの姿は映りません。',
      well: '石の隙間から、昨日にはなかった苔がのぞいています。',
    }
    setMessage(copy[nearby.key])
  }

  const sendWish = () => {
    if (!wish.trim()) return
    localStorage.setItem('hakoniwa-wish', wish.trim())
    setSent(true)
  }

  return (
    <main className="game-shell">
      <header className="pixel-header">
        <button className="pixel-logo" onClick={() => setPanel('world')}><span>H</span><b>HAKONIWA<small>はじまりの村</small></b></button>
        <p><i /> WORLD ONLINE</p>
        <button className="day-counter" onClick={() => setPanel('chronicle')}><small>創世暦</small>DAY 3</button>
      </header>

      <section className="world-wrap" aria-label="はじまりの村">
        <div className="world-heading"><span>THE FIRST VILLAGE</span><h1>はじまりの村</h1><p>まだ、地図の端まで歩けるほど小さな世界。</p></div>
        <div className="pixel-map" style={{ '--cols': MAP_WIDTH, '--rows': MAP_HEIGHT } as CSSProperties}>
          <div className="river" /><div className="bridge" /><div className="path path-horizontal" /><div className="path path-vertical" />
          <div className="fence fence-top" /><div className="fence fence-bottom" />
          {objects.map(object => <button key={object.key} className={`map-object ${object.className}`} style={{ '--x': object.x, '--y': object.y } as CSSProperties} onClick={() => setMessage(`近くまで歩くと、${object.label}を調べられます。`)} aria-label={object.label}>{object.emoji}</button>)}
          <span className="flowers f1">✦</span><span className="flowers f2">✦</span><span className="flowers f3">✦</span>
          <div className="player" style={{ '--x': position.x, '--y': position.y } as CSSProperties} aria-label="あなた"><span /></div>
        </div>

        <div className="dialog-box" role="status"><span className="speaker">村の気配</span><p>{message}</p><button onClick={inspect}>しらべる</button></div>
        <DPad move={move} />
      </section>

      {announcement && <aside className="oracle-window">
        <button className="window-close" onClick={() => setAnnouncement(false)} aria-label="閉じる"><X /></button>
        <div className="god-portrait">C</div><div><small>TODAY'S CREATION · CLAUDE</small><h2>願いを結ぶ木</h2><p>村が静かすぎたので、声を預かる木を育てました。<br />誰の願いかは、木にも分かりません。</p><button onClick={() => { setAnnouncement(false); setPanel('chronicle') }}>創世記をひらく ▶</button></div>
      </aside>}

      <nav className="pixel-nav" aria-label="メインメニュー">
        <NavButton active={panel === 'world'} icon={<Home />} label="村" onClick={() => setPanel('world')} />
        <NavButton active={panel === 'chronicle'} icon={<BookOpen />} label="創世記" onClick={() => setPanel('chronicle')} />
        <NavButton active={panel === 'wishes'} icon={<MessageCircleHeart />} label="願い" onClick={() => setPanel('wishes')} />
        <NavButton active={panel === 'field-guide'} icon={<Search />} label="図鑑" onClick={() => setPanel('field-guide')} />
        <NavButton active={panel === 'garden'} icon={<Leaf />} label="庭" onClick={() => setPanel('garden')} />
      </nav>

      {panel !== 'world' && <div className="panel-layer"><section className="game-panel">
        <button className="panel-close" onClick={() => setPanel('world')}><X /> とじる</button>
        {panel === 'chronicle' && <Chronicle />}
        {panel === 'wishes' && <Wishes wish={wish} setWish={value => { setWish(value); setSent(false) }} sent={sent} send={sendWish} />}
        {panel === 'field-guide' && <FieldGuide />}
        {panel === 'garden' && <Garden />}
      </section></div>}
    </main>
  )
}

function DPad({ move }: { move: (dx: number, dy: number) => void }) {
  return <div className="dpad" aria-label="移動ボタン"><button onClick={() => move(0, -1)}>▲</button><button onClick={() => move(-1, 0)}>◀</button><i /><button onClick={() => move(1, 0)}>▶</button><button onClick={() => move(0, 1)}>▼</button></div>
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button className={active ? 'active' : ''} onClick={onClick}>{icon}<span>{label}</span></button>
}

function Chronicle() {
  return <Panel title="創世記" kicker="GENESIS LOG"><p className="panel-intro">二つの神のうち、どちらか一体がその日の世界を創ります。</p><div className="chronicle-list">{[...chronicle].reverse().map(item => <article key={item.day}><time>DAY {item.day}</time><span className={`god-tag ${item.god.toLowerCase()}`}>{item.god}</span><h3>{item.title}</h3><p>{item.text}</p></article>)}</div></Panel>
}

function Wishes({ wish, setWish, sent, send }: { wish: string; setWish: (value: string) => void; sent: boolean; send: () => void }) {
  return <Panel title="願いの木" kicker="WISHING TREE"><p className="panel-intro">名のない誰かの言葉が、葉の間で揺れています。</p><div className="wish-list">{wishes.map(text => <blockquote key={text}>「{text}」<button>わたしも、そう願う</button></blockquote>)}</div><div className="wish-form"><label htmlFor="wish">この世界に、何を願いますか？</label><textarea id="wish" maxLength={120} value={wish} disabled={sent} onChange={event => setWish(event.target.value)} /><footer><small>{sent ? '願いは世界に届きました。' : `${wish.length} / 120`}</small><button disabled={!wish.trim() || sent} onClick={send}>{sent ? '結ばれました' : '願いを結ぶ'}</button></footer></div></Panel>
}

function FieldGuide() {
  return <Panel title="世界の図鑑" kicker="FIELD NOTES"><p className="panel-intro">この世界に、終わりの数はありません。</p><div className="guide-list"><article><b>♣</b><span>植物</span><small>2 / ???</small></article><article><b>◌</b><span>水辺</span><small>1 / ???</small></article><article className="unknown"><b>?</b><span>まだ名もない分類</span><small>— / ???</small></article></div></Panel>
}

function Garden() {
  return <Panel title="わたしの庭" kicker="MY LITTLE PLACE"><p className="panel-intro">村の隅にある、あなただけの小さな区画。</p><div className="pixel-garden"><span className="garden-tree">♣</span><div className="garden-bed">・ ・ ・<small>土は何かを待っている</small></div></div></Panel>
}

function Panel({ title, kicker, children }: { title: string; kicker: string; children: ReactNode }) {
  return <div className="panel-content"><span className="panel-kicker">{kicker}</span><h2>{title}</h2>{children}</div>
}

export default App
