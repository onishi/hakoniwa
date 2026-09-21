import { useState } from 'react'
import { BookOpen, ChevronLeft, Compass, Footprints, Home, Leaf, MessageCircleHeart, Search, Sparkles, X } from 'lucide-react'

type Panel = 'world' | 'chronicle' | 'wishes' | 'field-guide' | 'garden'

const wishes = [
  'いつか海を見てみたい',
  '庭に蝶が来ますように',
  'この卵が、無事に孵りますように',
]

const chronicle = [
  { day: 1, title: 'はじまり', text: '神は、小さな大地と一本の木、静かな池を創りました。' },
  { day: 2, title: '火の誕生', text: '神は暗がりを見つめ、「火」を世界に置きました。' },
  { day: 3, title: '水面の気配', text: '池が少し寂しいと思い、神は「魚」を創りました。' },
  { day: 4, title: '芽吹きの約束', text: '土の中に、まだ名もない「種」が眠りはじめました。' },
  { day: 5, title: '成長', text: '神は植物に、時とともに姿を変える力を与えました。' },
  { day: 6, title: '小さな訪問者', text: '今朝、神の知らない白い花が一輪、池のほとりに咲いていました。' },
]

function App() {
  const [panel, setPanel] = useState<Panel>('world')
  const [announcement, setAnnouncement] = useState(true)
  const [wish, setWish] = useState(() => localStorage.getItem('hakoniwa-wish') ?? '')
  const [sent, setSent] = useState(() => Boolean(localStorage.getItem('hakoniwa-wish')))
  const [inspected, setInspected] = useState<string | null>(null)

  const sendWish = () => {
    if (!wish.trim()) return
    localStorage.setItem('hakoniwa-wish', wish.trim())
    setSent(true)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setPanel('world')} aria-label="世界へ戻る">
          <span className="brand-mark"><Leaf size={17} /></span>
          <span><b>HAKONIWA</b><small>はじまりの庭</small></span>
        </button>
        <div className="world-time"><span className="pulse-dot" />世界は静かに息をしています</div>
        <button className="day-pill" onClick={() => setPanel('chronicle')}><span>創世暦</span><b>DAY 6</b></button>
      </header>

      <section className="stage">
        <div className="ambient ambient-one" /><div className="ambient ambient-two" />
        <div className="sky-copy"><span>THE BEGINNING GARDEN</span><h1>まだ、名もない世界。</h1><p>風の音と、水の気配。<br />ここからすべてが始まります。</p></div>
        <div className="island" aria-label="小さな浮島">
          <div className="island-soil"><i /><i /><i /></div>
          <div className="grass-top">
            <button className="world-object tree" onClick={() => setInspected('tree')} aria-label="木を調べる"><span className="trunk"/><span className="crown c1"/><span className="crown c2"/><span className="crown c3"/></button>
            <button className="world-object pond" onClick={() => setInspected('pond')} aria-label="池を調べる"><span className="ripple r1"/><span className="ripple r2"/><span className="fish">›</span></button>
            <button className="world-object fire" onClick={() => setInspected('fire')} aria-label="火を調べる"><span>◆</span></button>
            <button className="world-object flower" onClick={() => setInspected('flower')} aria-label="白い花を調べる">✣</button>
            <div className="traveler"><span className="head"/><span className="body"/><span className="shadow"/></div>
            <span className="grass g1">〽</span><span className="grass g2">〽</span><span className="grass g3">〽</span>
          </div>
        </div>
        <div className="world-actions">
          <button onClick={() => setInspected('walk')}><Footprints size={19}/><span>歩く<small>世界を巡る</small></span></button>
          <button onClick={() => setInspected('look')}><Search size={19}/><span>調べる<small>気配を探す</small></span></button>
          <button className="wish-action" onClick={() => setPanel('wishes')}><Sparkles size={19}/><span>願う<small>神へ届ける</small></span></button>
        </div>
        <p className="hint"><Compass size={13}/> 気になるものに、そっと触れてみましょう</p>
      </section>

      {announcement && <aside className="revelation">
        <div className="god-seal"><Sparkles size={20}/></div>
        <div><span className="eyebrow">TODAY'S CREATION</span><p className="day-label">創世暦 六日目</p><h2>神の知らない花</h2><p>神は今日、何も創造していません。<br/>けれど池のほとりに、白い花が咲いていました。</p><button onClick={() => {setAnnouncement(false); setPanel('chronicle')}}>創世記をひらく <span>→</span></button></div>
        <button className="close" onClick={() => setAnnouncement(false)} aria-label="閉じる"><X size={17}/></button>
      </aside>}

      {inspected && <div className="discovery-toast" role="status"><span>{inspected === 'flower' ? '✣' : '◌'}</span><div><b>{inspectionCopy(inspected)[0]}</b><small>{inspectionCopy(inspected)[1]}</small></div><button onClick={() => setInspected(null)}><X size={14}/></button></div>}

      <nav className="dock" aria-label="メインメニュー">
        <NavButton active={panel === 'world'} icon={<Home/>} label="世界" onClick={() => setPanel('world')}/>
        <NavButton active={panel === 'chronicle'} icon={<BookOpen/>} label="創世記" onClick={() => setPanel('chronicle')}/>
        <NavButton active={panel === 'wishes'} icon={<MessageCircleHeart/>} label="願いの木" onClick={() => setPanel('wishes')}/>
        <NavButton active={panel === 'field-guide'} icon={<Search/>} label="図鑑" onClick={() => setPanel('field-guide')}/>
        <NavButton active={panel === 'garden'} icon={<Leaf/>} label="わたしの庭" onClick={() => setPanel('garden')}/>
      </nav>

      {panel !== 'world' && <div className="panel-backdrop" onClick={() => setPanel('world')}><section className="panel" onClick={e => e.stopPropagation()}>
        <button className="panel-back" onClick={() => setPanel('world')}><ChevronLeft/> 世界へ戻る</button>
        {panel === 'chronicle' && <Chronicle/>}
        {panel === 'wishes' && <Wishes wish={wish} setWish={v => {setWish(v); setSent(false)}} sent={sent} send={sendWish}/>} 
        {panel === 'field-guide' && <FieldGuide/>}
        {panel === 'garden' && <Garden/>}
      </section></div>}
    </main>
  )
}

function NavButton({active, icon, label, onClick}: {active:boolean; icon: React.ReactNode; label:string; onClick:()=>void}) {
  return <button className={active ? 'active' : ''} onClick={onClick}>{icon}<span>{label}</span></button>
}

function Chronicle() { return <div className="panel-content"><span className="section-kicker">GENESIS</span><h2>創世記</h2><p className="intro">この世界に起きたことは、忘れられずにここへ刻まれます。</p><div className="timeline">{[...chronicle].reverse().map((item, i) => <article key={item.day} className={i === 0 ? 'latest' : ''}><time>DAY {item.day}</time><div><h3>{item.title}</h3><p>{item.text}</p></div></article>)}</div></div> }

function Wishes({wish, setWish, sent, send}:{wish:string; setWish:(v:string)=>void; sent:boolean; send:()=>void}) { return <div className="panel-content wishes"><span className="section-kicker">THE WISHING TREE</span><h2>願いの木</h2><p className="intro">枝に結ばれた言葉が、風に揺れています。誰が書いたのかは分かりません。</p><div className="wish-leaves">{wishes.map((w,i)=><blockquote key={w} className={`wish-${i}`}>「{w}」<button>わたしも、そう願う</button></blockquote>)}</div><div className="wish-form"><label htmlFor="wish">この世界に、何を願いますか？</label><textarea id="wish" maxLength={120} value={wish} disabled={sent} onChange={e=>setWish(e.target.value)} placeholder="まだ世界にないものを、そっと言葉に…"/><div><small>{sent ? '🌱 あなたの願いは、世界に届きました。' : `${wish.length} / 120`}</small><button disabled={!wish.trim() || sent} onClick={send}>{sent ? '願いを結びました' : '枝に願いを結ぶ'}</button></div></div></div> }

function FieldGuide() { return <div className="panel-content"><span className="section-kicker">FIELD NOTES</span><h2>世界の図鑑</h2><p className="intro">見つけたものだけが記されます。この世界に、終わりの数はありません。</p><div className="guide-grid"><Guide emoji="♧" title="植物" count="3 / ???"/><Guide emoji="◌" title="魚" count="1 / ???"/><Guide emoji="◇" title="鉱物" count="0 / ???" locked/><div className="unknown-card"><span>?</span><p>まだ名もない分類</p></div></div><article className="specimen"><span className="specimen-art">✣</span><div><small>NEW · DAY 6</small><h3>名もない白い花</h3><p>神の記憶にはない花。朝、水辺で初めて観測された。花びらは六枚。</p><b>由来：不明</b></div></article></div> }
function Guide({emoji,title,count,locked=false}:{emoji:string;title:string;count:string;locked?:boolean}) { return <div className={`guide-card ${locked?'locked':''}`}><span>{emoji}</span><h3>{title}</h3><p>{count}</p></div> }
function Garden() { return <div className="panel-content"><span className="section-kicker">YOUR LITTLE PLACE</span><h2>わたしの庭</h2><p className="intro">世界のどこかに重なる、あなただけの小さな土地。</p><div className="garden-plot"><div className="plot-tree">♣</div><div className="empty-bed"><span>· · ·</span><p>土は、何かを待っています</p></div><div className="seed"><span>◉</span><p>名もない種 × 1</p><button>土に埋める</button></div></div></div> }

function inspectionCopy(key:string):[string,string] { return ({tree:['はじまりの木','世界で最初の木。葉の間で、風が眠っています。'],pond:['静かな池','水面の下に、小さな影がひとつ見えました。'],fire:['世界で最初の火','暖かい。昨日、神が置いていったものです。'],flower:['発見：名もない白い花','神にも覚えのない花。図鑑に新しい頁が生まれました。'],walk:['あなたは少し歩きました','草を踏んだ跡が、しばらく世界に残ります。'],look:['耳を澄ませました','木の向こうから、誰かが石を置く音がしました。']} as Record<string,[string,string]>)[key] }

export default App
