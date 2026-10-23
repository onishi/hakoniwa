import { launch } from '@cloudflare/playwright'
import { rainMirrorAvailable, worldClimate } from './climate'
import { createApprovedProposalRun, type SharedWorldSnapshot } from './world-creation'

interface Env extends CloudflareBindings {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  GITHUB_TOKEN: string
  APP_MODE?: 'day1' | 'evolution'
}

type User = { id: number; email: string; display_name: string; avatar_url: string | null }

// The first expansion opens on Day 22; the later small region opens on Day 48.
const MAP_WIDTH = 12
const MAP_HEIGHT = 12
const mapSize = (worldDay: number) => worldDay >= 91 ? { width: 22, height: 18 }
  : worldDay >= 48 ? { width: 18, height: 18 } : worldDay >= 22 ? { width: 16, height: 16 } : { width: MAP_WIDTH, height: MAP_HEIGHT }
type TerrainTile = { kind: string; elevation: number; traversal: 'ground' | 'slope' | 'water' }
const groundTile: TerrainTile = { kind: 'grass', elevation: 0, traversal: 'ground' }
const terrainAt = async (env: Env, x: number, y: number, worldDay: number) =>
  await env.DB.prepare(`SELECT kind, elevation, traversal FROM world_tiles WHERE x = ? AND y = ?
    AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?)`).bind(x, y, worldDay, worldDay)
    .first<TerrainTile>() ?? groundTile

/** The newest day that finished its work. A day still being built stays invisible. */
const isPreview = (env: Env) => env.APP_MODE === 'day1' || env.APP_MODE === 'evolution'

const publishedDay = (env: Env) =>
  env.DB.prepare(`SELECT world_day, oracle FROM world_days WHERE status = 'published'
    ${env.APP_MODE === 'day1' ? 'AND world_day = 1' : ''} ORDER BY world_day DESC LIMIT 1`)
    .first<{ world_day: number; oracle: string | null }>()

const setting = async (env: Env, key: string) => {
  const row = await env.DB.prepare('SELECT value FROM world_settings WHERE key = ?').bind(key).first<{ value: string }>()
  return row?.value ?? null
}

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } })

const hash = async (value: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function recordHabitatCare(env: Env, userId: number, worldDay: number) {
  if (worldDay < 45) return false
  const result = await env.DB.prepare(`INSERT OR REPLACE INTO player_habitat_care
    (user_id, prepared_day, flower_color, garden_x, garden_y)
    SELECT ?, ?, insects.flower_color, garden.x, garden.y
    FROM player_insects AS insects JOIN player_garden_tiles AS garden ON garden.user_id = insects.user_id
    WHERE insects.user_id = ? AND insects.flower_tended_day = ? AND garden.last_watered_day = ?
      AND garden.status = 'watered' ORDER BY garden.updated_at DESC LIMIT 1`)
    .bind(userId, worldDay, userId, worldDay, worldDay).run()
  return Boolean(result.meta.changes)
}

async function gardenSignals(env: Env, userId: number, worldDay: number) {
  const [care, flower, spring] = await Promise.all([
    env.DB.prepare(`SELECT garden_x, garden_y FROM player_habitat_care
      WHERE user_id = ? AND prepared_day < ? ORDER BY prepared_day DESC LIMIT 1`)
      .bind(userId, worldDay).first<{ garden_x: number; garden_y: number }>(),
    env.DB.prepare('SELECT flower_tended FROM player_insects WHERE user_id = ?')
      .bind(userId).first<{ flower_tended: number }>(),
    env.DB.prepare('SELECT first_day FROM player_east_observations WHERE user_id = ?')
      .bind(userId).first<{ first_day: number }>(),
  ])
  return { water: Boolean(care), flower: Boolean(flower?.flower_tended), spring: Boolean(spring),
    ready: Boolean(care && flower?.flower_tended && spring), garden: care ? { x: care.garden_x, y: care.garden_y } : null }
}

async function recordEcologyEvent(env: Env, userId: number, worldDay: number, eventKey: string) {
  if (worldDay < 59) return false
  const result = await env.DB.prepare(`INSERT OR IGNORE INTO player_ecology_events
    (user_id, world_day, event_key) VALUES (?, ?, ?)`).bind(userId, worldDay, eventKey).run()
  return Boolean(result.meta.changes)
}

type FieldSubject = { subject_key: string; entity_key: string; trace_key: string | null; label: string;
  place: string; movement: string; message_template: string; discover_day: number; observe_distance: number }

const fieldNote = (subject: FieldSubject, worldDay: number) => {
  const climate = worldClimate(worldDay)
  const slots: Record<string, string> = {
    subject: subject.label,
    weather: climate.weather === 'rain' ? '雨' : climate.weather === 'cloud' ? '曇り' : '晴れ',
    phase: climate.phase === 'morning' ? '朝' : climate.phase === 'evening' ? '夕方' : '夜',
    place: subject.place,
    movement: subject.movement,
  }
  return subject.message_template.replace(/\{(subject|weather|phase|place|movement)\}/g, (_, key: string) => slots[key])
}

async function recordFieldObservation(env: Env, userId: number, worldDay: number, subjectKey: string, fromTrace = false) {
  if (worldDay < 88) return false
  const subject = await env.DB.prepare('SELECT * FROM field_subjects WHERE subject_key = ? AND discover_day <= ?')
    .bind(subjectKey, worldDay).first<FieldSubject>()
  if (!subject) return false
  const note = `${fromTrace ? '羽の跡から、かつてこの場所にいたことを知りました。' : ''}${fieldNote(subject, worldDay)}`
  const result = await env.DB.prepare(`INSERT OR IGNORE INTO player_field_observations
    (user_id, subject_key, first_seen_day, first_note) VALUES (?, ?, ?, ?)`)
    .bind(userId, subjectKey, worldDay, note).run()
  return Boolean(result.meta.changes)
}

type ExpeditionRecord = { hp: number; trips: number; readiness: number; inside: number;
  encounter: 'idle' | 'active'; calmed_day: number | null; defeats: number }

const expeditionView = (row: ExpeditionRecord | null) => ({ hp: row?.hp ?? 3, maxHp: 3,
  trips: row?.trips ?? 0, readiness: Boolean(row?.readiness), inside: Boolean(row?.inside),
  encounter: row?.encounter ?? 'idle', calmed: Boolean(row?.calmed_day), defeats: row?.defeats ?? 0 })

const readExpedition = (env: Env, userId: number) => env.DB.prepare(`SELECT hp, trips, readiness, inside,
  encounter, calmed_day, defeats FROM player_expeditions WHERE user_id = ?`).bind(userId).first<ExpeditionRecord>()

const cookieValue = (request: Request, name: string) => {
  const part = request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))
  return part?.slice(name.length + 1)
}

async function currentUser(request: Request, env: Env): Promise<User | null> {
  const token = cookieValue(request, 'hakoniwa_session')
  if (!token) return null
  return env.DB.prepare(`SELECT users.id, email, display_name, avatar_url FROM sessions
    JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > datetime('now')`)
    .bind(await hash(token)).first<User>()
}

const sessionCookie = (token: string, maxAge: number) =>
  `hakoniwa_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === '/api/preview-login' && request.method === 'POST' && isPreview(env)) {
    if (request.headers.get('origin') !== url.origin) return json({ error: 'このページから操作してください。' }, 403)
    const identity = randomToken()
    await env.DB.prepare('INSERT INTO users (google_sub, email, display_name) VALUES (?, ?, ?)')
      .bind(`preview:${identity}`, 'preview@example.invalid', '検証中の観測者').run()
    const user = await env.DB.prepare('SELECT id FROM users WHERE google_sub = ?')
      .bind(`preview:${identity}`).first<{ id: number }>()
    const session = randomToken()
    await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))")
      .bind(await hash(session), user!.id).run()
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(session, 60 * 60 * 24 * 30) })
  }

  if (url.pathname === '/api/auth/google' && request.method === 'GET') {
    if (isPreview(env)) return json({ error: 'この環境ではGoogleログインを使用しません。' }, 404)
    const state = randomToken()
    await env.DB.prepare("INSERT INTO oauth_states (state_hash, expires_at) VALUES (?, datetime('now', '+10 minutes'))")
      .bind(await hash(state)).run()
    const callback = `${url.origin}/api/auth/google/callback`
    const target = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    target.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: callback, response_type: 'code', scope: 'openid email profile', state }).toString()
    return Response.redirect(target.toString(), 302)
  }

  if (url.pathname === '/api/auth/google/callback' && request.method === 'GET') {
    if (isPreview(env)) return json({ error: 'この環境ではGoogleログインを使用しません。' }, 404)
    const state = url.searchParams.get('state')
    const code = url.searchParams.get('code')
    if (!state || !code) return json({ error: '認証を完了できませんでした。' }, 400)
    const valid = await env.DB.prepare("DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > datetime('now') RETURNING state_hash")
      .bind(await hash(state)).first()
    if (!valid) return json({ error: '認証の有効期限が切れました。' }, 400)

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${url.origin}/api/auth/google/callback`, grant_type: 'authorization_code' }),
    })
    if (!tokenResponse.ok) return json({ error: 'Google認証に失敗しました。' }, 502)
    const token = await tokenResponse.json<{ access_token: string }>()
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${token.access_token}` } })
    if (!profileResponse.ok) return json({ error: 'プロフィールを取得できませんでした。' }, 502)
    const profile = await profileResponse.json<{ sub: string; email: string; name?: string; picture?: string }>()
    await env.DB.prepare(`INSERT INTO users (google_sub, email, display_name, avatar_url) VALUES (?, ?, ?, ?)
      ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email, display_name=excluded.display_name, avatar_url=excluded.avatar_url, updated_at=CURRENT_TIMESTAMP`)
      .bind(profile.sub, profile.email, profile.name ?? profile.email, profile.picture ?? null).run()
    const user = await env.DB.prepare('SELECT id FROM users WHERE google_sub = ?').bind(profile.sub).first<{ id: number }>()
    const session = randomToken()
    await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))")
      .bind(await hash(session), user!.id).run()
    return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': sessionCookie(session, 60 * 60 * 24 * 30) } })
  }

  if (url.pathname === '/api/session' && request.method === 'GET') {
    const user = await currentUser(request, env)
    return json({ user: user ? { name: user.display_name, avatarUrl: user.avatar_url } : null, mode: env.APP_MODE ?? 'production' })
  }

  if (url.pathname === '/api/expedition') {
    const today = await publishedDay(env)
    if (!today || today.world_day < 92) return json({ error: '外の旅はまだ始まっていません。' }, 409)
    const user = await currentUser(request, env)
    if (!user) return json({ error: '旅の記録を始めてください。' }, 401)
    if (request.method === 'GET') return json({ expedition: expeditionView(await readExpedition(env, user.id)) })
    if (request.method !== 'POST') return json({ error: '操作できません。' }, 405)
    if (request.headers.get('origin') !== url.origin) return json({ error: 'このページから操作してください。' }, 403)
    const input = await request.json<{ action?: string; x?: number; y?: number }>()
    const x = Number(input.x)
    const y = Number(input.y)
    const size = mapSize(today.world_day)
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || x >= size.width - 1 || y < 1 || y >= size.height - 1) {
      return json({ error: 'そこからは旅を記録できません。' }, 400)
    }
    await env.DB.prepare('INSERT OR IGNORE INTO player_expeditions (user_id) VALUES (?)').bind(user.id).run()
    const current = await readExpedition(env, user.id)
    if (input.action === 'enter') {
      if (x < 17) return json({ error: '村の外へ出てください。' }, 409)
      if (!current?.inside) await env.DB.prepare(`UPDATE player_expeditions SET inside = 1, entered_day = ?,
        updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND inside = 0`).bind(today.world_day, user.id).run()
      return json({ expedition: expeditionView(await readExpedition(env, user.id)),
        message: current?.inside ? '草原を歩いています。' : '村の外へ出ました。戻る道も見えています。' })
    }
    if (input.action === 'return') {
      if (x >= 17) return json({ error: '村の道へ戻ってください。' }, 409)
      if (current?.inside) await env.DB.prepare(`UPDATE player_expeditions SET inside = 0, trips = trips + 1,
        readiness = 1, hp = 3, encounter = 'idle', updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND inside = 1`).bind(user.id).run()
      return json({ expedition: expeditionView(await readExpedition(env, user.id)),
        message: current?.inside ? '村へ戻りました。道に慣れ、体力が戻りました。' : '村の道にいます。' })
    }
    if (input.action === 'contact') {
      if (today.world_day < 93) return json({ error: '草原に相手はいません。' }, 409)
      const enemy = await env.DB.prepare(`SELECT x, y FROM world_entities WHERE entity_key = 'field-stray'
        AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?)`).bind(today.world_day, today.world_day)
        .first<{ x: number; y: number }>()
      if (!enemy || !current?.inside || Math.abs(x - enemy.x) + Math.abs(y - enemy.y) > 1) {
        return json({ error: '獣は近くにいません。' }, 409)
      }
      if (current.calmed_day) return json({ expedition: expeditionView(current), message: '獣は落ち着いて道の脇にいます。' })
      if (current.encounter === 'active') return json({ expedition: expeditionView(current), message: '獣が目の前にいます。離れる道を選べます。' })
      const changed = await env.DB.prepare(`UPDATE player_expeditions SET
        hp = CASE WHEN hp <= 1 THEN 3 ELSE hp - 1 END,
        encounter = CASE WHEN hp <= 1 THEN 'idle' ELSE 'active' END,
        defeats = defeats + CASE WHEN hp <= 1 THEN 1 ELSE 0 END,
        inside = CASE WHEN hp <= 1 THEN 0 ELSE inside END,
        updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND inside = 1 AND encounter = 'idle'
        RETURNING hp, trips, readiness, inside, encounter, calmed_day, defeats`)
        .bind(user.id).first<ExpeditionRecord>()
      if (!changed) return json({ error: 'もう一度、周りを見てください。' }, 409)
      const defeated = changed.inside === 0
      return json({ expedition: expeditionView(changed), defeated,
        returnTo: defeated ? { x: 16, y: 10 } : null,
        message: defeated ? '力尽き、村の入口へ戻りました。持ち物はそのまま、体力も戻っています。'
          : '獣と出会い、体力が1減りました。離れるか、道を変えて進めます。' })
    }
    if (input.action === 'avoid' || input.action === 'calm') {
      if (input.action === 'calm' && today.world_day < 94) return json({ error: 'まだ鎮める方法がわかりません。' }, 409)
      const changed = await env.DB.prepare(`UPDATE player_expeditions SET encounter = 'idle',
        calmed_day = CASE WHEN ? = 'calm' THEN COALESCE(calmed_day, ?) ELSE calmed_day END,
        updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND inside = 1 AND encounter = 'active'
        RETURNING hp, trips, readiness, inside, encounter, calmed_day, defeats`)
        .bind(input.action, today.world_day, user.id).first<ExpeditionRecord>()
      if (!changed) return json({ error: '向き合っている相手はいません。' }, 409)
      return json({ expedition: expeditionView(changed), message: input.action === 'calm'
        ? '声を落として待つと、獣は道の脇で落ち着きました。もう傷つけられません。'
        : '獣から離れました。別の道を通れば接触を避けられます。' })
    }
    return json({ error: 'その行動はできません。' }, 400)
  }

  if (url.pathname === '/api/logout' && request.method === 'POST') {
    const token = cookieValue(request, 'hakoniwa_session')
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hash(token)).run()
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) })
  }

  if (url.pathname === '/api/save') {
    const user = await currentUser(request, env)
    if (!user) return json({ error: 'ログインしてください。' }, 401)
    if (request.method === 'GET') {
      const row = await env.DB.prepare('SELECT data, updated_at FROM saves WHERE user_id = ?').bind(user.id).first<{ data: string; updated_at: string }>()
      return json({ save: row ? JSON.parse(row.data) : null, updatedAt: row?.updated_at ?? null })
    }
    if (request.method === 'PUT') {
      const data = await request.json<unknown>()
      const encoded = JSON.stringify(data)
      if (encoded.length > 16_384) return json({ error: 'セーブデータが大きすぎます。' }, 413)
      await env.DB.prepare(`INSERT INTO saves (user_id, data) VALUES (?, ?) ON CONFLICT(user_id)
        DO UPDATE SET data=excluded.data, updated_at=CURRENT_TIMESTAMP`).bind(user.id, encoded).run()
      return json({ ok: true })
    }
  }

  if (url.pathname === '/api/inventory' && request.method === 'GET') {
    const user = await currentUser(request, env)
    if (!user) return json({ error: '持ち物を見るにはログインしてください。' }, 401)
    const items = await env.DB.prepare(`SELECT player_items.item_key AS key,
      COALESCE(world_entities.label, CASE player_items.item_key
        WHEN 'item-sprout' THEN '育った芽' WHEN 'item-ore' THEN '石のかけら' WHEN 'item-wood' THEN '木材' END) AS label,
      player_items.quantity, player_items.first_picked_day AS firstPickedDay
      FROM player_items LEFT JOIN world_entities ON world_entities.entity_key = player_items.item_key
      WHERE player_items.user_id = ? AND player_items.placed_at IS NULL
      ORDER BY player_items.first_picked_day, player_items.item_key`).bind(user.id).all()
    return json({ items: items.results })
  }

  if (url.pathname === '/api/fishing' && request.method === 'GET') {
    const user = await currentUser(request, env)
    if (!user) return json({ error: '記録を始めてください。' }, 401)
    const today = await publishedDay(env)
    if (!today || today.world_day < 8) return json({ state: 'idle', rodBorrowed: false })
    const [fishing, observed] = await Promise.all([
      env.DB.prepare('SELECT rod_borrowed, state, world_day, last_release_habitat, bank_seen_day FROM player_fishing WHERE user_id = ?')
        .bind(user.id).first<{ rod_borrowed: number; state: string; world_day: number; last_release_habitat: string | null; bank_seen_day: number | null }>(),
      today.world_day >= 33 ? env.DB.prepare('SELECT habitat_key FROM player_habitat_observations WHERE user_id = ?')
        .bind(user.id).all<{ habitat_key: string }>() : Promise.resolve({ results: [] as { habitat_key: string }[] }),
    ])
    return json({
      state: fishing?.world_day === today.world_day ? fishing.state : 'idle',
      rodBorrowed: Boolean(fishing?.rod_borrowed),
      observedHabitats: observed.results.map(row => row.habitat_key),
      lastReleaseHabitat: today.world_day >= 44 ? fishing?.last_release_habitat ?? null : null,
      bankSeen: today.world_day >= 43 && Boolean(fishing?.bank_seen_day),
    })
  }

  if (url.pathname === '/api/fishing' && request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return json({ error: 'このページから操作してください。' }, 403)
    const user = await currentUser(request, env)
    if (!user) return json({ error: '釣りには、まず記録を始めてください。' }, 401)
    const today = await publishedDay(env)
    if (!today || today.world_day < 7) return json({ error: 'まだ釣り竿はありません。' }, 409)
    const input = await request.json<{ target?: string; x?: number; y?: number }>()
    const x = Number(input.x)
    const y = Number(input.y)
    const size = mapSize(today.world_day)
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || y < 1 || x >= size.width - 1 || y >= size.height - 1) {
      return json({ error: 'そこからは届きません。' }, 400)
    }
    const key = input.target === 'rod' ? 'fishing-rod' : input.target === 'pond' ? 'pond' : null
    if (!key) return json({ error: '釣る場所を選んでください。' }, 400)
    const target = await env.DB.prepare(`SELECT x, y, width, height FROM world_entities
      WHERE entity_key = ? AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?)`)
      .bind(key, today.world_day, today.world_day).first<{ x: number; y: number; width: number; height: number }>()
    if (!target) return json({ error: 'そこにはまだ何もありません。' }, 404)
    const dx = Math.max(target.x - x, 0, x - target.x - target.width + 1)
    const dy = Math.max(target.y - y, 0, y - target.y - target.height + 1)
    if (dx + dy > 1) return json({ error: 'もう少し近づいてください。' }, 409)

    await env.DB.prepare(`INSERT OR IGNORE INTO player_fishing (user_id, world_day) VALUES (?, ?)`)
      .bind(user.id, today.world_day).run()
    await env.DB.prepare(`UPDATE player_fishing SET state = 'idle', world_day = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND world_day < ?`).bind(today.world_day, user.id, today.world_day).run()
    if (key === 'fishing-rod') {
      await env.DB.prepare(`UPDATE player_fishing SET rod_borrowed = 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`)
        .bind(user.id).run()
      return json({ state: 'idle', message: '釣り竿を借りました。魚影のある池へ向けてアクションしてください。' })
    }
    if (today.world_day < 8) return json({ error: '魚影をもう少し観察してください。' }, 409)
    const habitat = x <= target.x - 1 || y <= target.y - 1 ? 'shallow' : 'deep'
    const habitatName = habitat === 'shallow' ? '浅瀬' : '深場'
    const fishing = await env.DB.prepare('SELECT rod_borrowed, state FROM player_fishing WHERE user_id = ?')
      .bind(user.id).first<{ rod_borrowed: number; state: 'idle' | 'cast' | 'caught' }>()
    if (fishing?.state === 'idle' && today.world_day >= 49) {
      const compared = await env.DB.prepare(`UPDATE player_east_observations SET compared_day = ?
        WHERE user_id = ? AND compared_day IS NULL AND EXISTS
          (SELECT 1 FROM player_habitat_observations WHERE user_id = ?)
        RETURNING compared_day`).bind(today.world_day, user.id, user.id).first()
      if (compared) return json({ state: 'idle', comparedWaters: true,
        message: '庭の池には細い魚影と丸い魚影。東の泉には水面を滑る虫がいます。二つの水辺の違いを観察記録に残しました。' })
    }
    if (fishing?.state === 'idle' && today.world_day >= 43 && x >= target.x + target.width && y >= target.y && y < target.y + target.height) {
      const bank = await env.DB.prepare(`UPDATE player_fishing SET bank_seen_day = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND bank_seen_day IS NULL RETURNING bank_seen_day`)
        .bind(today.world_day, user.id).first()
      if (bank) return json({ state: 'idle', bankSeen: true,
        message: '池の東の縁で、細く角ばった三つ目の魚影を見つけました。ほかの二匹と通り道が違います。' })
    }
    if (fishing?.state === 'idle' && today.world_day >= 33) {
      if (today.world_day >= 47) {
        const prior = await env.DB.prepare(`SELECT first_day FROM player_habitat_observations
          WHERE user_id = ? AND habitat_key = ?`).bind(user.id, habitat).first<{ first_day: number }>()
        if (prior && prior.first_day < today.world_day) {
          const revisit = await env.DB.prepare(`INSERT OR IGNORE INTO player_revisits
            (user_id, habitat_key, world_day) VALUES (?, ?, ?)`).bind(user.id, habitat, today.world_day).run()
          if (revisit.meta.changes) return json({ state: 'idle', revisitedHabitat: habitat,
            message: `DAY ${prior.first_day} に見た${habitatName}へ戻りました。同じ魚影の通り道が、今日も水面に残っています。` })
        }
      }
      const observation = await env.DB.prepare(`INSERT OR IGNORE INTO player_habitat_observations
        (user_id, habitat_key, first_day) VALUES (?, ?, ?)`).bind(user.id, habitat, today.world_day).run()
      if (observation.meta.changes) {
        const meadowSeen = today.world_day >= 40 ? await env.DB.prepare('SELECT meadow_observed_count FROM player_insects WHERE user_id = ?')
          .bind(user.id).first<{ meadow_observed_count: number }>() : null
        return json({ state: 'idle', observedHabitat: habitat,
          message: (habitat === 'shallow'
          ? '浅瀬を観察記録に残しました。細い魚影が水草の縁をゆっくり通ります。釣るなら竿を借りて、もう一度アクションしてください。'
          : '深場を観察記録に残しました。丸い魚影が底の暗い線を速く横切ります。釣るなら竿を借りて、もう一度アクションしてください。')
          + (meadowSeen?.meadow_observed_count ? ' 草むらの歩く虫も見たので、二つの居場所が記録につながりました。' : '') })
      }
    }
    if (!fishing?.rod_borrowed) return json({ error: '池のそばで竿を借りてください。' }, 409)
    if (fishing.state === 'idle') {
      const changed = await env.DB.prepare(`UPDATE player_fishing SET state = 'cast', updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND state = 'idle' RETURNING state`).bind(user.id).first()
      if (!changed) return json({ error: 'もう一度、池を見てください。' }, 409)
      return json({ state: 'cast', message: today.world_day >= 31
        ? `${habitatName}へ糸を垂らしました。浮きが揺れています。もう一度アクションすると釣れそうです。`
        : '浮きが揺れました。もう一度アクションすると釣れそうです。' })
    }
    if (fishing.state === 'cast') {
      if (today.world_day < 10) return json({ state: 'cast', message: '魚影が近づいています。もう少し待ちましょう。' })
      const changed = await env.DB.prepare(`UPDATE player_fishing SET state = 'caught', updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND state = 'cast' RETURNING state`).bind(user.id).first()
      if (!changed) return json({ error: 'もう一度、池を見てください。' }, 409)
      return json({ state: 'caught', message: '小さな魚が釣れました。池へ向けてもう一度アクションすると戻せます。' })
    }
    const changed = await env.DB.prepare(`UPDATE player_fishing SET state = 'idle', released_count = released_count + 1,
      last_release_habitat = CASE WHEN ? >= 44 THEN ? ELSE last_release_habitat END,
      updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND state = 'caught' RETURNING released_count`)
      .bind(today.world_day, habitat, user.id).first<{ released_count: number }>()
    if (!changed) return json({ error: 'もう一度、池を見てください。' }, 409)
    return json({ state: 'idle', releasedCount: changed.released_count,
      lastReleaseHabitat: today.world_day >= 44 ? habitat : null,
      message: today.world_day >= 44
        ? `${habitatName}から魚を池へ戻しました。この岸の放流を観察記録に残しました。魚影が泳ぎ去ります。`
        : '魚を池へ戻しました。魚影がゆっくり泳ぎ去ります。' })
  }

  if (url.pathname === '/api/east-spring' && request.method === 'GET') {
    const user = await currentUser(request, env)
    const today = await publishedDay(env)
    if (!user || !today || today.world_day < 48) return json({ seen: false, compared: false })
    const record = await env.DB.prepare('SELECT compared_day FROM player_east_observations WHERE user_id = ?')
      .bind(user.id).first<{ compared_day: number | null }>()
    return json({ seen: Boolean(record), compared: Boolean(record?.compared_day) })
  }

  if (url.pathname === '/api/east-spring' && request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return json({ error: 'このページから操作してください。' }, 403)
    const today = await publishedDay(env)
    if (!today || today.world_day < 48) return json({ error: '東の泉はまだありません。' }, 409)
    const input = await request.json<{ x?: number; y?: number }>()
    const x = Number(input.x)
    const y = Number(input.y)
    const size = mapSize(today.world_day)
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || y < 1 || x >= size.width - 1 || y >= size.height - 1) {
      return json({ error: 'そこからは届きません。' }, 400)
    }
    const spring = await env.DB.prepare(`SELECT x, y FROM world_entities WHERE entity_key = 'east-spring'
      AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?)`).bind(today.world_day, today.world_day)
      .first<{ x: number; y: number }>()
    if (!spring || Math.abs(x - spring.x) + Math.abs(y - spring.y) > 1) return json({ error: '泉のそばへ来てください。' }, 409)
    const user = await currentUser(request, env)
    if (!user) return json({ seen: false, compared: false,
      message: '東の泉は小さく、水面を滑る虫がいます。記録を始めると池との違いを残せます。' })
    await env.DB.prepare(`INSERT OR IGNORE INTO player_east_observations (user_id, first_day)
      VALUES (?, ?)`).bind(user.id, today.world_day).run()
    if (today.world_day >= 49) {
      const compared = await env.DB.prepare(`UPDATE player_east_observations SET compared_day = ?
        WHERE user_id = ? AND compared_day IS NULL AND EXISTS
          (SELECT 1 FROM player_habitat_observations WHERE user_id = ?)
        RETURNING compared_day`).bind(today.world_day, user.id, user.id).first()
      if (compared) return json({ seen: true, compared: true,
        message: '庭の池の魚影と、東の泉の水面を滑る虫。二つの水辺の違いを観察記録に残しました。' })
    }
    return json({ seen: true, compared: false,
      message: today.world_day >= 49
        ? '泉には水面を滑る虫がいます。庭の池にも行き、魚影との違いを確かめましょう。'
        : '東の泉を観察記録に残しました。庭の池より小さく、波紋が短く広がります。' })
  }

  if (url.pathname === '/api/ecology' && request.method === 'GET') {
    const user = await currentUser(request, env)
    const today = await publishedDay(env)
    if (!user || !today || today.world_day < 51) return json({ birdSeen: false, nestSeen: false, featherSeen: false })
    const [row, signals, events] = await Promise.all([
      env.DB.prepare(`SELECT bird_seen_day, nest_seen_day, feather_seen_day, garden_seen_day
        FROM player_ecology_observations WHERE user_id = ?`).bind(user.id)
        .first<{ bird_seen_day: number | null; nest_seen_day: number | null; feather_seen_day: number | null; garden_seen_day: number | null }>(),
      today.world_day >= 56 ? gardenSignals(env, user.id, today.world_day) : Promise.resolve(null),
      today.world_day >= 59 ? env.DB.prepare(`SELECT event_key FROM player_ecology_events
        WHERE user_id = ? AND world_day = ? ORDER BY event_key`).bind(user.id, today.world_day)
        .all<{ event_key: string }>() : Promise.resolve({ results: [] as { event_key: string }[] }),
    ])
    return json({ birdSeen: Boolean(row?.bird_seen_day), nestSeen: Boolean(row?.nest_seen_day),
      featherSeen: Boolean(row?.feather_seen_day), gardenSeen: Boolean(row?.garden_seen_day), gardenSignals: signals ? {
        water: signals.water, flower: signals.flower, spring: signals.spring, ready: signals.ready,
      } : null, todayEvents: events.results.map(event => event.event_key) })
  }

  if (url.pathname === '/api/ecology' && request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return json({ error: 'このページから操作してください。' }, 403)
    const today = await publishedDay(env)
    if (!today || today.world_day < 51) return json({ error: '泉の小鳥はまだいません。' }, 409)
    const input = await request.json<{ target?: string; x?: number; y?: number }>()
    if (input.target === 'garden-visitor' && today.world_day >= 57) {
      const user = await currentUser(request, env)
      if (!user) return json({ error: '庭の記録を始めてください。' }, 401)
      const signals = await gardenSignals(env, user.id, today.world_day)
      if (!signals.garden || typeof input.x !== 'number' || typeof input.y !== 'number' ||
        !Number.isInteger(input.x) || !Number.isInteger(input.y) ||
        Math.abs(input.x - signals.garden.x) + Math.abs(input.y - signals.garden.y) > 1) {
        return json({ error: '庭の訪問者のそばへ来てください。' }, 409)
      }
      if (!signals.ready) return json({ observed: false,
        message: '訪問者は庭へ来ています。花を整え、泉も観察すると、別の反応が見られそうです。' })
      await env.DB.prepare('INSERT OR IGNORE INTO player_ecology_observations (user_id) VALUES (?)').bind(user.id).run()
      const firstSeen = await env.DB.prepare(`UPDATE player_ecology_observations SET garden_seen_day = ?
        WHERE user_id = ? AND garden_seen_day IS NULL RETURNING garden_seen_day`)
        .bind(today.world_day, user.id).first()
      const recordedToday = await recordEcologyEvent(env, user.id, today.world_day, 'garden-visitor')
      return json({ observed: true, firstSeen: Boolean(firstSeen), recordedToday,
        message: '花と水と泉を知る訪問者が、庭で立ち止まりました。捕まえずに見守った記録が残ります。' })
    }
    const target = input.target === 'east-bird' ? { x: 14, y: 15, day: 51, column: 'bird_seen_day' }
      : input.target === 'east-nest' ? { x: 14, y: 16, day: 52, column: 'nest_seen_day' }
      : input.target === 'east-feather' ? { x: 13, y: 16, day: 53, column: 'feather_seen_day' } : null
    const x = Number(input.x)
    const y = Number(input.y)
    const size = mapSize(today.world_day)
    if (!target || today.world_day < target.day) return json({ error: 'そこにはまだ何もありません。' }, 404)
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || y < 1 || x >= size.width - 1 || y >= size.height - 1 ||
      Math.abs(x - target.x) + Math.abs(y - target.y) > 1) return json({ error: 'もう少し近づいてください。' }, 409)
    const user = await currentUser(request, env)
    if (!user) return json({ message: input.target === 'east-bird'
      ? '小鳥は泉の虫を見て、草の方へ飛び戻りました。' : '草の中に、小鳥がいた跡があります。' })
    await env.DB.prepare('INSERT OR IGNORE INTO player_ecology_observations (user_id) VALUES (?)').bind(user.id).run()
    if (input.target === 'east-feather') {
      const nest = await env.DB.prepare('SELECT nest_seen_day FROM player_ecology_observations WHERE user_id = ?')
        .bind(user.id).first<{ nest_seen_day: number | null }>()
      if (!nest?.nest_seen_day || nest.nest_seen_day >= today.world_day) return json({ error: '前の日までに巣を観察してください。' }, 409)
    }
    const changed = await env.DB.prepare(`UPDATE player_ecology_observations SET ${target.column} = ?
      WHERE user_id = ? AND ${target.column} IS NULL RETURNING ${target.column}`)
      .bind(today.world_day, user.id).first()
    const recordedToday = await recordEcologyEvent(env, user.id, today.world_day, input.target!)
    return json({ observed: Boolean(changed), recordedToday, message: input.target === 'east-bird'
      ? '泉の小鳥は水面を滑る虫を追い、草の方へ短く飛び戻ります。'
      : input.target === 'east-nest'
        ? '草の巣を観察記録に残しました。次に来たときは、近くの地面も見てみましょう。'
        : '巣のそばの羽を観察記録に残しました。拾って数を増やさず、鳥の暮らしの跡として残します。' })
  }

  if (url.pathname === '/api/insects' && request.method === 'GET') {
    const user = await currentUser(request, env)
    if (!user) return json({ state: 'free', netBorrowed: false, released: false, flowerTended: false })
    const insects = await env.DB.prepare('SELECT net_borrowed, state, released_count, flower_tended, flower_color, meadow_observed_count FROM player_insects WHERE user_id = ?')
      .bind(user.id).first<{ net_borrowed: number; state: 'free' | 'held'; released_count: number; flower_tended: number; flower_color: string; meadow_observed_count: number }>()
    return json({
      state: insects?.state ?? 'free',
      netBorrowed: Boolean(insects?.net_borrowed),
      released: Boolean(insects?.released_count),
      flowerTended: Boolean(insects?.flower_tended),
      flowerColor: insects?.flower_color ?? 'white',
      meadowObserved: Boolean(insects?.meadow_observed_count),
    })
  }

  if (url.pathname === '/api/habitat-care' && request.method === 'GET') {
    const user = await currentUser(request, env)
    if (!user) return json({ care: null })
    const today = await publishedDay(env)
    if (!today || today.world_day < 45) return json({ care: null })
    const care = await env.DB.prepare(`SELECT prepared_day, flower_color, garden_x, garden_y
      FROM player_habitat_care WHERE user_id = ? AND prepared_day <= ?
      ORDER BY prepared_day DESC LIMIT 1`).bind(user.id, today.world_day)
      .first<{ prepared_day: number; flower_color: string; garden_x: number; garden_y: number }>()
    return json({ care: care ? {
      preparedDay: care.prepared_day, flowerColor: care.flower_color,
      garden: { x: care.garden_x, y: care.garden_y }, revisited: today.world_day > care.prepared_day,
    } : null })
  }

  if (url.pathname === '/api/insects' && request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return json({ error: 'このページから操作してください。' }, 403)
    const today = await publishedDay(env)
    if (!today || today.world_day < 12) return json({ error: 'まだ虫の気配はありません。' }, 409)
    const input = await request.json<{ target?: string; x?: number; y?: number }>()
    const x = Number(input.x)
    const y = Number(input.y)
    const size = mapSize(today.world_day)
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || y < 1 || x >= size.width - 1 || y >= size.height - 1) {
      return json({ error: 'そこからは届きません。' }, 400)
    }
    const key = input.target === 'grass' ? 'insect-grass'
      : input.target === 'meadow' ? 'insect-meadow'
      : input.target === 'striped' ? 'insect-striped'
      : input.target === 'net' ? 'insect-net'
        : input.target === 'flowers' ? 'insect-flowers' : null
    if (!key) return json({ error: '場所を選んでください。' }, 400)
    const target = await env.DB.prepare(`SELECT x, y, width, height FROM world_entities
      WHERE entity_key = ? AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?)`)
      .bind(key, today.world_day, today.world_day).first<{ x: number; y: number; width: number; height: number }>()
    if (!target) return json({ error: 'そこにはまだ何もありません。' }, 404)
    const dx = Math.max(target.x - x, 0, x - target.x - target.width + 1)
    const dy = Math.max(target.y - y, 0, y - target.y - target.height + 1)
    if (dx + dy > 1) return json({ error: 'もう少し近づいてください。' }, 409)

    const user = await currentUser(request, env)
    if (!user && key === 'insect-grass') return json({ state: 'free', message: '草むらの虫が葉の間を行き来しています。' })
    if (key === 'insect-striped') {
      if (today.world_day < 41) return json({ error: 'まだ縞の虫はいません。' }, 409)
      return json({ message: '東の草地で、縞のある虫が葉の下を折り返して歩いています。岸辺の虫とは姿も速さも違います。' })
    }
    if (key === 'insect-meadow') {
      if (today.world_day < 35) return json({ error: 'まだ歩く虫はいません。' }, 409)
      if (user) {
        await env.DB.prepare('INSERT OR IGNORE INTO player_insects (user_id, world_day) VALUES (?, ?)')
          .bind(user.id, today.world_day).run()
        await env.DB.prepare('UPDATE player_insects SET observed_count = observed_count + 1, meadow_observed_count = meadow_observed_count + 1, world_day = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
          .bind(today.world_day, user.id).run()
      }
      const pondSeen = user && today.world_day >= 40 ? await env.DB.prepare('SELECT habitat_key FROM player_habitat_observations WHERE user_id = ? LIMIT 1')
        .bind(user.id).first() : null
      return json({ message: pondSeen
        ? '池の魚影を見たあと、草むらの歩く虫にも気づきました。二つの居場所を往復した記録が残りました。'
        : '葉の下を丸い虫が歩いています。岸辺を飛ぶ虫よりゆっくり動きます。' })
    }
    if (!user) return json({ error: '記録するには、まず検証用の記録を始めてください。' }, 401)
    await env.DB.prepare('INSERT OR IGNORE INTO player_insects (user_id, world_day) VALUES (?, ?)')
      .bind(user.id, today.world_day).run()
    await env.DB.prepare('UPDATE player_insects SET world_day = ? WHERE user_id = ?')
      .bind(today.world_day, user.id).run()
    const insects = await env.DB.prepare('SELECT net_borrowed, state, flower_tended FROM player_insects WHERE user_id = ?')
      .bind(user.id).first<{ net_borrowed: number; state: 'free' | 'held'; flower_tended: number }>()
    if (key === 'insect-net') {
      if (today.world_day < 13) return json({ error: 'まだ網はありません。' }, 409)
      await env.DB.prepare('UPDATE player_insects SET net_borrowed = 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
        .bind(user.id).run()
      return json({ state: insects?.state ?? 'free', netBorrowed: true, message: '網を借りました。草むらへ向けてアクションしてください。' })
    }
    if (key === 'insect-grass') {
      if (today.world_day < 14 || !insects?.net_borrowed) {
        await env.DB.prepare('UPDATE player_insects SET observed_count = observed_count + 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
          .bind(user.id).run()
        return json({ state: insects?.state ?? 'free', message: '草むらの虫が葉の間を行き来しています。' })
      }
      if (insects.state === 'held') return json({ state: 'held', message: '虫を持っています。岸辺の花のそばへ戻せます。' })
      const changed = await env.DB.prepare(`UPDATE player_insects SET state = 'held', updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND state = 'free' RETURNING state`).bind(user.id).first()
      if (!changed) return json({ error: 'もう一度、草むらを見てください。' }, 409)
      return json({ state: 'held', message: '小さな虫を網に迎えました。岸辺の花へ戻せます。' })
    }
    if (insects?.state === 'held') {
      const changed = await env.DB.prepare(`UPDATE player_insects SET state = 'free', released_count = released_count + 1,
        updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND state = 'held' RETURNING released_count`)
        .bind(user.id).first<{ released_count: number }>()
      if (!changed) return json({ error: 'もう一度、花を見てください。' }, 409)
      return json({ state: 'free', released: true, releasedCount: changed.released_count, flowerTended: Boolean(insects.flower_tended), message: '虫を花のそばへ戻しました。葉の間に姿が見えます。' })
    }
    if (today.world_day < 15) return json({ state: 'free', message: '花のそばで虫を待てそうです。' })
    if (today.world_day >= 36) {
      const changed = await env.DB.prepare(`UPDATE player_insects SET flower_tended = 1,
        flower_color = CASE flower_color WHEN 'white' THEN 'yellow' ELSE 'white' END,
        flower_tended_day = CASE WHEN ? >= 45 THEN ? ELSE flower_tended_day END,
        updated_at = CURRENT_TIMESTAMP WHERE user_id = ? RETURNING flower_color`)
        .bind(today.world_day, today.world_day, user.id).first<{ flower_color: string }>()
      const careReady = await recordHabitatCare(env, user.id, today.world_day)
      return json({ state: 'free', flowerTended: true, flowerColor: changed?.flower_color,
        message: (changed?.flower_color === 'yellow'
          ? '花を黄色に整えました。明るい羽の虫が寄ってきます。もう一度で白い花にできます。'
          : '花を白色に整えました。淡い羽の虫が寄ってきます。もう一度で黄色い花にできます。')
          + (careReady ? ' 水をやった庭とともに、次の訪問の準備が残りました。' : '') })
    }
    await env.DB.prepare('UPDATE player_insects SET flower_tended = 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
      .bind(user.id).run()
    return json({ state: 'free', flowerTended: true, message: '花のまわりを整えました。次の訪問でも虫が来られそうです。' })
  }

  if (url.pathname === '/api/shore-observe' && request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return json({ error: 'このページから操作してください。' }, 403)
    const today = await publishedDay(env)
    if (!today || today.world_day < 39) return json({ error: 'まだ岸辺の反応はわかりません。' }, 409)
    const input = await request.json<{ x?: number; y?: number }>()
    const x = Number(input.x)
    const y = Number(input.y)
    const creature = await env.DB.prepare(`SELECT x, y FROM world_entities WHERE entity_key = 'shore-creature'
      AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?)`).bind(today.world_day, today.world_day)
      .first<{ x: number; y: number }>()
    if (!creature || !Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x - creature.x) + Math.abs(y - creature.y) > 1) {
      return json({ error: '岸辺の生き物に近づいてください。' }, 409)
    }
    return json({ message: y < creature.y
      ? '池に近い北側で待つと、小さな生き物は水面を見たまま落ち着いています。'
      : '草地側から近づくと、小さな生き物は一歩離れて立ち止まります。少し待つと戻ります。' })
  }

  if (url.pathname === '/api/pickup' && request.method === 'POST') {
    const user = await currentUser(request, env)
    if (!user) return json({ error: '拾うには検証用の記録を始めてください。' }, 401)
    const input = await request.json<{ key?: string }>()
    const key = input.key?.trim() ?? ''
    const today = await publishedDay(env)
    if (!key || !today || today.world_day < 4) return json({ error: 'まだ拾えるものはありません。' }, 400)
    if (today.world_day >= 10) {
      const [held, recent] = await Promise.all([
        env.DB.prepare("SELECT COALESCE(SUM(quantity), 0) AS total FROM player_items WHERE user_id = ? AND placed_at IS NULL").bind(user.id).first<{ total: number }>(),
        env.DB.prepare('SELECT COUNT(*) AS total FROM player_item_events WHERE user_id = ? AND world_day = ?').bind(user.id, today.world_day).first<{ total: number }>(),
      ])
      if ((held?.total ?? 0) >= 5) return json({ error: '持てるものは5つまでです。' }, 429)
      if ((recent?.total ?? 0) >= 5) return json({ error: '今日はもう十分に拾いました。' }, 429)
    }
    const object = await env.DB.prepare(`SELECT entity_key FROM world_entities
      WHERE entity_key = ? AND kind = 'item' AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?)`)
      .bind(key, today.world_day, today.world_day).first<{ entity_key: string }>()
    if (!object) return json({ error: 'そこには拾えるものがありません。' }, 404)
    const result = await env.DB.prepare(`INSERT OR IGNORE INTO player_items (user_id, item_key, quantity, first_picked_day)
      VALUES (?, ?, 1, ?)`).bind(user.id, key, today.world_day).run()
    if (!result.meta.changes) return json({ error: 'それは、もう手に持っています。' }, 409)
    await env.DB.prepare('INSERT OR IGNORE INTO player_item_events (user_id, item_key, world_day) VALUES (?, ?, ?)').bind(user.id, key, today.world_day).run()
    return json({ ok: true, item: { key, quantity: 1, firstPickedDay: today.world_day } }, 201)
  }

  if (url.pathname === '/api/place' && request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return json({ error: 'このページから操作してください。' }, 403)
    const user = await currentUser(request, env)
    if (!user) return json({ error: '置くには検証用の記録を始めてください。' }, 401)
    const input = await request.json<{ itemKey?: string; x?: number; y?: number }>()
    const itemKey = input.itemKey?.trim() ?? ''
    const x = Number(input.x)
    const y = Number(input.y)
    const today = await publishedDay(env)
    if (!today || today.world_day < 6) return json({ error: 'まだ置けるものはありません。' }, 400)
    const size = mapSize(today.world_day)
    if (!itemKey || !Number.isInteger(x) || !Number.isInteger(y) || x < 1 || x > size.width - 2 || y < 1 || y > size.height - 2) {
      return json({ error: 'そこには置けません。' }, 400)
    }
    if (today.world_day >= 61 && (await terrainAt(env, x, y, today.world_day)).traversal === 'water') {
      return json({ error: '水の中には置けません。' }, 409)
    }
    const held = await env.DB.prepare(`SELECT player_items.item_key FROM player_items
      WHERE user_id = ? AND item_key = ? AND placed_at IS NULL`).bind(user.id, itemKey).first()
    if (!held) return json({ error: '手に持っているものがありません。' }, 409)
    if (itemKey === 'item-lantern' || (itemKey === 'item-reed' && today.world_day >= 38) ||
      (itemKey === 'item-field-bundle' && today.world_day >= 96)) {
      if (itemKey === 'item-lantern' && today.world_day < 29) return json({ error: '灯りを置けるのは DAY 29 からです。' }, 409)
      if ((itemKey === 'item-lantern' || itemKey === 'item-field-bundle') && (x > 10 || y > 10)) return json({ error: '最初の庭に置いてください。' }, 409)
      if (itemKey === 'item-reed' && (x < 6 || x > 9 || y < 6 || y > 9)) return json({ error: '葦は池のそばに置いてください。' }, 409)
      const [occupied, path, garden, trace, decoration] = await Promise.all([
        env.DB.prepare(`SELECT entity_key FROM world_entities WHERE x <= ? AND x + width > ? AND y <= ? AND y + height > ?
          AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?) LIMIT 1`)
          .bind(x, x, y, y, today.world_day, today.world_day).first(),
        env.DB.prepare(`SELECT kind FROM world_tiles WHERE x = ? AND y = ? AND kind = 'path'
          AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?) LIMIT 1`)
          .bind(x, y, today.world_day, today.world_day).first(),
        env.DB.prepare('SELECT status FROM player_garden_tiles WHERE user_id = ? AND x = ? AND y = ?')
          .bind(user.id, x, y).first(),
        env.DB.prepare("SELECT id FROM traces WHERE x = ? AND y = ? AND expires_at > datetime('now') LIMIT 1")
          .bind(x, y).first(),
        env.DB.prepare('SELECT item_key FROM player_decorations WHERE user_id = ? AND x = ? AND y = ? LIMIT 1')
          .bind(user.id, x, y).first(),
      ])
      if (occupied || path || garden || trace || decoration) return json({ error: 'その場所には置けません。' }, 409)
      const token = randomToken()
      const results = await env.DB.batch([
        env.DB.prepare(`INSERT OR IGNORE INTO player_decorations (user_id, item_key, x, y, world_day, placement_token)
          SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (
            SELECT 1 FROM player_items WHERE user_id = ? AND item_key = ? AND placed_at IS NULL)`)
          .bind(user.id, itemKey, x, y, today.world_day, token, user.id, itemKey),
        env.DB.prepare(`UPDATE player_items SET quantity = CASE WHEN quantity > 1 THEN quantity - 1 ELSE quantity END,
          placed_at = CASE WHEN quantity > 1 THEN NULL ELSE CURRENT_TIMESTAMP END, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND item_key = ? AND placed_at IS NULL
          AND EXISTS (SELECT 1 FROM player_decorations WHERE user_id = ? AND item_key = ? AND placement_token = ?)`)
          .bind(user.id, itemKey, user.id, itemKey, token),
      ])
      if (!results[0].meta.changes) return json({ error: itemKey === 'item-lantern' ? '灯りはすでに庭にあります。' : itemKey === 'item-field-bundle' ? '草と木の束はすでに庭にあります。' : '葦はすでに池のそばにあります。' }, 409)
      return json({ ok: true, decoration: true, message: itemKey === 'item-lantern'
        ? '小さな灯りを庭に置きました。次に来たときも、ここにあります。'
        : itemKey === 'item-field-bundle' ? '外の草と村の木で作った束を庭に置きました。次に来たときも、ここにあります。'
        : '葦を池のそばに置きました。次に来たときも、水辺で揺れています。' }, 201)
    }
    const blocked = await env.DB.prepare(`SELECT entity_key FROM world_entities
      WHERE x <= ? AND x + width > ? AND y <= ? AND y + height > ?
      AND blocks = 1 AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?)`)
      .bind(x, x, y, y, today.world_day, today.world_day).first()
    if (blocked) return json({ error: 'そこには置けません。' }, 409)
    await env.DB.prepare(`INSERT INTO traces (user_id, item_key, x, y, world_day, expires_at)
      VALUES (?, ?, ?, ?, ?, datetime('now', '+30 days'))`).bind(user.id, itemKey, x, y, today.world_day).run()
    await env.DB.prepare('UPDATE player_items SET placed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND item_key = ?')
      .bind(user.id, itemKey).run()
    return json({ ok: true }, 201)
  }

  if (url.pathname === '/api/reclaim-trace' && request.method === 'POST') {
    const user = await currentUser(request, env)
    if (!user) return json({ error: '再取得には検証用の記録を始めてください。' }, 401)
    const input = await request.json<{ traceId?: number }>()
    const traceId = Number(input.traceId)
    if (!Number.isInteger(traceId)) return json({ error: 'その跡は見つかりません。' }, 400)
    const trace = await env.DB.prepare(`SELECT traces.item_key, world_entities.label FROM traces
      JOIN world_entities ON world_entities.entity_key = traces.item_key
      WHERE traces.id = ? AND traces.user_id = ? AND traces.expires_at > datetime('now')`)
      .bind(traceId, user.id).first<{ item_key: string; label: string }>()
    if (!trace) return json({ error: 'その跡は、あなたが置いたものではありません。' }, 403)
    await env.DB.prepare('UPDATE player_items SET placed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND item_key = ?')
      .bind(user.id, trace.item_key).run()
    await env.DB.prepare('DELETE FROM traces WHERE id = ? AND user_id = ?').bind(traceId, user.id).run()
    return json({ ok: true, item: { key: trace.item_key, label: trace.label, quantity: 1 } }, 200)
  }

  if (url.pathname === '/api/garden-action' && request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return json({ error: 'このページから操作してください。' }, 403)
    const user = await currentUser(request, env)
    if (!user) return json({ error: '庭を育てるには検証用の記録を始めてください。' }, 401)
    const input = await request.json<{ x?: number; y?: number }>()
    const x = Number(input.x)
    const y = Number(input.y)
    const today = await publishedDay(env)
    if (!today || today.world_day < 17) return json({ error: 'まだ庭を耕せません。' }, 409)
    const size = mapSize(today.world_day)
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || y < 1 || x >= size.width - 1 || y >= size.height - 1) {
      return json({ error: 'そこは庭の外です。' }, 400)
    }
    const [occupied, path, terrain] = await Promise.all([
      env.DB.prepare(`SELECT entity_key FROM world_entities WHERE x <= ? AND x + width > ? AND y <= ? AND y + height > ?
        AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?) LIMIT 1`)
        .bind(x, x, y, y, today.world_day, today.world_day).first(),
      env.DB.prepare(`SELECT kind FROM world_tiles WHERE x = ? AND y = ? AND kind = 'path'
        AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?) LIMIT 1`)
        .bind(x, y, today.world_day, today.world_day).first(),
      today.world_day >= 61 ? env.DB.prepare(`SELECT kind FROM world_tiles WHERE x = ? AND y = ?
        AND kind IN ('hill', 'slope', 'stream') AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?)`)
        .bind(x, y, today.world_day, today.world_day).first() : Promise.resolve(null),
    ])
    if (occupied || path) return json({ error: 'その場所には植えられません。' }, 409)
    const tile = await env.DB.prepare('SELECT status, seed_key, updated_at FROM player_garden_tiles WHERE user_id = ? AND x = ? AND y = ?')
      .bind(user.id, x, y).first<{ status: string; seed_key: string | null; updated_at: string }>()
    if (terrain && !tile) return json({ error: 'この地形は庭にできません。' }, 409)
    if (!tile) {
      await env.DB.prepare(`INSERT INTO player_garden_tiles (user_id, x, y, status) VALUES (?, ?, ?, 'tilled')`).bind(user.id, x, y).run()
      return json({ ok: true, state: 'tilled', message: '土を耕しました。' })
    }
    if (tile.status === 'tilled') {
      if (today.world_day < 18) return json({ error: '実を植えられるのは DAY 18 からです。' }, 409)
      const seed = await env.DB.prepare(`SELECT item_key FROM player_items WHERE user_id = ? AND placed_at IS NULL
        AND (item_key IN ('item-seed', 'item-berry', 'item-sprout') OR (? >= 79 AND item_key = 'item-windseed'))
        ORDER BY CASE item_key WHEN 'item-windseed' THEN 0 WHEN 'item-berry' THEN 1 WHEN 'item-seed' THEN 2 ELSE 3 END LIMIT 1`)
        .bind(user.id, today.world_day).first<{ item_key: string }>()
      if (!seed) return json({ error: '植える種を持っていません。' }, 409)
      await env.DB.prepare(`UPDATE player_items SET quantity = CASE WHEN quantity > 1 THEN quantity - 1 ELSE quantity END,
        placed_at = CASE WHEN quantity > 1 THEN NULL ELSE CURRENT_TIMESTAMP END, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND item_key = ? AND placed_at IS NULL`).bind(user.id, seed.item_key).run()
      await env.DB.prepare(`UPDATE player_garden_tiles SET status = 'planted', seed_key = ?, planted_day = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND x = ? AND y = ?`)
        .bind(seed.item_key, today.world_day, user.id, x, y).run()
      return json({ ok: true, state: 'planted', message: seed.item_key === 'item-windseed' ? '風の種を植えました。' : '種を植えました。' })
    }
    if (tile.status === 'planted' && today.world_day >= 19) {
      await env.DB.prepare(`UPDATE player_garden_tiles SET status = 'watered', last_watered_day = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND x = ? AND y = ?`)
        .bind(today.world_day, user.id, x, y).run()
      const careReady = await recordHabitatCare(env, user.id, today.world_day)
      return json({ ok: true, state: 'watered', message: '水をやりました。少し待つと芽が育ちます。'
        + (careReady ? ' 花の手入れとともに、次の訪問の準備が残りました。' : '') })
    }
    if (tile.status === 'watered' && today.world_day >= 20 && tile.updated_at <= new Date(Date.now() - 90_000).toISOString().replace('T', ' ').slice(0, 19)) {
      await env.DB.prepare(`UPDATE player_garden_tiles SET status = 'tilled', seed_key = NULL, planted_day = NULL, last_watered_day = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND x = ? AND y = ?`)
        .bind(user.id, x, y).run()
      await env.DB.prepare(`INSERT INTO player_items (user_id, item_key, quantity, first_picked_day, placed_at)
        VALUES (?, 'item-sprout', 1, ?, NULL)
        ON CONFLICT(user_id, item_key) DO UPDATE SET
          quantity = CASE WHEN player_items.placed_at IS NULL THEN player_items.quantity + 1 ELSE 1 END,
          placed_at = NULL, updated_at = CURRENT_TIMESTAMP`)
        .bind(user.id, today.world_day).run()
    return json({ ok: true, state: 'harvested', message: '育った芽を採りました。持ち物に残ります。' })
    }
    return json({ error: '芽が育つまで、もう少し待ってください。' }, 409)
  }

  if (url.pathname === '/api/tool-action' && request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return json({ error: 'このページから操作してください。' }, 403)
    const user = await currentUser(request, env)
    if (!user) return json({ error: '道具を使うには検証用の記録を始めてください。' }, 401)
    const input = await request.json<{ key?: string; x?: number; y?: number }>()
    const today = await publishedDay(env)
    if (!today || today.world_day < 25) return json({ error: 'まだ掘ったり割ったりできません。' }, 409)
    const x = Number(input.x)
    const y = Number(input.y)
    const size = mapSize(today.world_day)
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || y < 1 || x >= size.width - 1 || y >= size.height - 1) {
      return json({ error: 'そこからは届きません。' }, 400)
    }
    const target = await env.DB.prepare(`SELECT entity_key, label, x, y, width, height FROM world_entities
      WHERE entity_key = ? AND kind = 'resource' AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?)`)
      .bind(input.key ?? '', today.world_day, today.world_day)
      .first<{ entity_key: string; label: string; x: number; y: number; width: number; height: number }>()
    if (!target) return json({ error: 'そこには道具を使えません。' }, 404)
    const dx = Math.max(target.x - x, 0, x - target.x - target.width + 1)
    const dy = Math.max(target.y - y, 0, y - target.y - target.height + 1)
    if (dx + dy > 1) return json({ error: 'もう少し近づいてください。' }, 409)
    const tool = await env.DB.prepare("SELECT item_key FROM player_items WHERE user_id = ? AND item_key = 'item-tool' AND placed_at IS NULL")
      .bind(user.id).first()
    if (!tool) return json({ error: '使える道具を持っていません。' }, 409)
    const held = await env.DB.prepare('SELECT COALESCE(SUM(quantity), 0) AS total FROM player_items WHERE user_id = ? AND placed_at IS NULL')
      .bind(user.id).first<{ total: number }>()
    if ((held?.total ?? 0) >= 5) return json({ error: '持てるものは5つまでです。' }, 429)
    const outputKey = target.entity_key === 'resource-rock' ? 'item-ore' : 'item-wood'
    await env.DB.prepare(`INSERT INTO player_items (user_id, item_key, quantity, first_picked_day, placed_at)
      VALUES (?, ?, 1, ?, NULL) ON CONFLICT(user_id, item_key) DO UPDATE SET
        quantity = CASE WHEN player_items.placed_at IS NULL THEN player_items.quantity + 1 ELSE 1 END,
        placed_at = NULL, updated_at = CURRENT_TIMESTAMP`)
      .bind(user.id, outputKey, today.world_day).run()
    return json({ ok: true, message: `${target.label}から${outputKey === 'item-ore' ? '石のかけら' : '木材'}を取り出しました。持ち物に残ります。` })
  }

  if (url.pathname === '/api/terrain-action' && request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return json({ error: 'このページから操作してください。' }, 403)
    const today = await publishedDay(env)
    if (!today || today.world_day < 64) return json({ error: 'まだこの地形を越えられません。' }, 409)
    const input = await request.json<{ action?: string; direction?: string; x?: number; y?: number }>()
    const direction = input.direction === 'up' ? { x: 0, y: -1 }
      : input.direction === 'down' ? { x: 0, y: 1 }
      : input.direction === 'left' ? { x: -1, y: 0 }
      : input.direction === 'right' ? { x: 1, y: 0 } : null
    const x = Number(input.x)
    const y = Number(input.y)
    const size = mapSize(today.world_day)
    if (!direction || !Number.isInteger(x) || !Number.isInteger(y) || x < 1 || y < 1 || x > size.width - 2 || y > size.height - 2) {
      return json({ error: 'そこからは進めません。' }, 400)
    }
    const front = { x: x + direction.x, y: y + direction.y }
    if (front.x < 1 || front.y < 1 || front.x > size.width - 2 || front.y > size.height - 2) return json({ error: '庭の外へは進めません。' }, 409)
    const [here, next] = await Promise.all([terrainAt(env, x, y, today.world_day), terrainAt(env, front.x, front.y, today.world_day)])
    let destination = front
    if (input.action === 'cross' && next.traversal === 'water') {
      destination = { x: front.x + direction.x, y: front.y + direction.y }
      if (destination.x < 1 || destination.y < 1 || destination.x > size.width - 2 || destination.y > size.height - 2) return json({ error: '渡る先がありません。' }, 409)
      const landing = await terrainAt(env, destination.x, destination.y, today.world_day)
      if (landing.traversal === 'water' || landing.elevation !== here.elevation) return json({ error: '向こう岸には降りられません。' }, 409)
    } else if (input.action === 'climb' && next.traversal !== 'water' && Math.abs(next.elevation - here.elevation) === 1 &&
      (next.traversal === 'slope' || here.traversal === 'slope')) {
      // Only the marked slope joins different heights.
    } else return json({ error: 'ここでは登れず、渡れません。' }, 409)
    const blocked = await env.DB.prepare(`SELECT entity_key FROM world_entities
      WHERE blocks = 1 AND x <= ? AND x + width > ? AND y <= ? AND y + height > ?
      AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?) LIMIT 1`)
      .bind(destination.x, destination.x, destination.y, destination.y, today.world_day, today.world_day).first()
    if (blocked) return json({ error: '行き先がふさがっています。' }, 409)
    return json({ position: destination, message: input.action === 'cross'
      ? '細い小川を渡りました。向こう岸へ足を着けます。'
      : next.elevation > here.elevation ? '斜面を登りました。丘の上が見渡せます。' : '斜面を下りました。庭の道へ戻れます。' })
  }

  if (url.pathname === '/api/stream-fishing' && request.method === 'GET') {
    const today = await publishedDay(env)
    const user = await currentUser(request, env)
    if (!today || today.world_day < 68 || !user) return json({ state: 'idle', observed: false })
    const record = await env.DB.prepare('SELECT first_seen_day, world_day, state, released_day, revisit_day FROM player_stream_fishing WHERE user_id = ?')
      .bind(user.id).first<{ first_seen_day: number; world_day: number; state: string; released_day: number | null; revisit_day: number | null }>()
    return json({ state: record?.world_day === today.world_day ? record.state : 'idle',
      observed: Boolean(record), released: Boolean(record?.released_day), revisited: Boolean(record?.revisit_day) })
  }

  if (url.pathname === '/api/stream-dragonfly' && request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return json({ error: 'このページから操作してください。' }, 403)
    const today = await publishedDay(env)
    if (!today || today.world_day < 71) return json({ error: '小川にトンボはまだいません。' }, 409)
    const input = await request.json<{ x?: number; y?: number }>()
    const x = Number(input.x)
    const y = Number(input.y)
    const size = mapSize(today.world_day)
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || y < 1 || x >= size.width - 1 || y >= size.height - 1) {
      return json({ error: 'そこからは届きません。' }, 400)
    }
    const dragonfly = await env.DB.prepare(`SELECT x, y FROM world_entities WHERE entity_key = 'stream-dragonfly'
      AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?)`)
      .bind(today.world_day, today.world_day).first<{ x: number; y: number }>()
    if (!dragonfly || Math.abs(x - dragonfly.x) + Math.abs(y - dragonfly.y) > 1) {
      return json({ error: '小川のトンボへ近づいてください。' }, 409)
    }
    if (today.world_day < 73) return json({ message: today.world_day >= 72
      ? 'トンボは水面から草へ飛び、また同じ流れの上へ戻ります。'
      : '細い羽のトンボが小川のそばに止まっています。' })
    const user = await currentUser(request, env)
    if (!user) return json({ message: 'トンボの飛ぶ道を見守りました。記録を始めると、次に来たときの違いがわかります。' })
    await recordFieldObservation(env, user.id, today.world_day, 'stream-dragonfly')
    const first = await env.DB.prepare(`INSERT OR IGNORE INTO player_stream_dragonfly (user_id, first_seen_day) VALUES (?, ?)`)
      .bind(user.id, today.world_day).run()
    const record = await env.DB.prepare('SELECT first_seen_day, linked_day, revisit_day FROM player_stream_dragonfly WHERE user_id = ?')
      .bind(user.id).first<{ first_seen_day: number; linked_day: number | null; revisit_day: number | null }>()
    const fish = today.world_day >= 74 ? await env.DB.prepare('SELECT released_day FROM player_stream_fishing WHERE user_id = ?')
      .bind(user.id).first<{ released_day: number | null }>() : null
    const linked = fish?.released_day && !record?.linked_day ? await env.DB.prepare(`UPDATE player_stream_dragonfly
      SET linked_day = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND linked_day IS NULL RETURNING linked_day`)
      .bind(today.world_day, user.id).first() : null
    const revisited = today.world_day >= 75 && record && record.first_seen_day < today.world_day && !record.revisit_day
      ? await env.DB.prepare(`UPDATE player_stream_dragonfly SET revisit_day = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND revisit_day IS NULL RETURNING revisit_day`).bind(today.world_day, user.id).first() : null
    return json({ observed: Boolean(first.meta.changes), linked: Boolean(linked || record?.linked_day), revisited: Boolean(revisited),
      message: revisited ? '前に見た小川へ戻りました。トンボは今日も水面と草の間を同じ順に飛んでいます。'
        : linked ? '魚を小川へ戻したあと、トンボは魚影を避けるように少し高く飛んでいます。二つの動きを観察記録につなげました。'
          : first.meta.changes ? 'トンボが水面と草を往復する飛び方を観察記録に残しました。'
            : record?.linked_day ? 'トンボは魚影の上を避け、草へ向かって少し高く飛びます。'
              : 'トンボは水面から草へ飛び、また同じ流れの上へ戻ります。' })
  }

  if (url.pathname === '/api/resident' && request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return json({ error: 'このページから操作してください。' }, 403)
    const today = await publishedDay(env)
    if (!today || today.world_day < 76) return json({ error: '住人はまだ来ていません。' }, 409)
    const input = await request.json<{ target?: string; x?: number; y?: number }>()
    if (input.target !== 'hill-resident' && input.target !== 'stream-resident') return json({ error: '話す相手を選んでください。' }, 400)
    const x = Number(input.x)
    const y = Number(input.y)
    const size = mapSize(today.world_day)
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || y < 1 || x >= size.width - 1 || y >= size.height - 1) {
      return json({ error: 'そこからは届きません。' }, 400)
    }
    const resident = await env.DB.prepare(`SELECT x, y FROM world_entities WHERE entity_key = ?
      AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?)`)
      .bind(input.target, today.world_day, today.world_day).first<{ x: number; y: number }>()
    if (!resident || Math.abs(x - resident.x) + Math.abs(y - resident.y) > 1) return json({ error: '住人へ近づいてください。' }, 409)
    const hill = input.target === 'hill-resident'
    const user = await currentUser(request, env)
    if (!user || today.world_day < 78) return json({ message: hill
      ? '丘の住人は「魚影は流れを上るけれど、石はずっとここにいる」と話します。'
      : '小川の住人は「石も水に磨かれれば、遠くまで旅をする」と話します。' })
    await env.DB.prepare('INSERT OR IGNORE INTO player_resident_relations (user_id) VALUES (?)').bind(user.id).run()
    const relation = await env.DB.prepare('SELECT gift_day, exchange_day, revisit_day FROM player_resident_relations WHERE user_id = ?')
      .bind(user.id).first<{ gift_day: number | null; exchange_day: number | null; revisit_day: number | null }>()
    if (hill) {
      if (!relation?.gift_day) {
        const claim = randomToken()
        const results = await env.DB.batch([
          env.DB.prepare(`UPDATE player_resident_relations SET gift_day = ?, gift_token = ?, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND gift_day IS NULL AND EXISTS
              (SELECT 1 FROM player_items WHERE user_id = ? AND item_key = 'item-ore' AND placed_at IS NULL)
            RETURNING gift_day`).bind(today.world_day, claim, user.id, user.id),
          env.DB.prepare(`UPDATE player_items SET quantity = CASE WHEN quantity > 1 THEN quantity - 1 ELSE quantity END,
            placed_at = CASE WHEN quantity > 1 THEN NULL ELSE CURRENT_TIMESTAMP END, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND item_key = 'item-ore' AND placed_at IS NULL AND EXISTS
              (SELECT 1 FROM player_resident_relations WHERE user_id = ? AND gift_token = ?)`)
            .bind(user.id, user.id, claim),
        ])
        if (results[0].meta.changes) return json({ gift: true,
          message: '丘の住人へ石のかけらを渡しました。「この丘を覚えておきます」と受け取ります。' })
        return json({ message: '丘の住人は石のかけらに関心があるようです。丘の石から採って持っていけます。' })
      }
      return json({ remembered: true, message: today.world_day >= 80
        ? '丘の住人は渡した石を覚えています。「あの石を見て、小川の道を考えています」。'
        : '丘の住人は石のかけらを手元に置き、流れの音を聞いています。' })
    }
    if (today.world_day < 79) return json({ message: '小川の住人は流木を眺めています。丘の住人へ石を渡した話を聞いてみたいようです。' })
    if (!relation?.gift_day) return json({ message: '小川の住人は丘の住人が見つけた石の話を聞きたがっています。' })
    if (!relation.exchange_day) {
      const claim = randomToken()
      const results = await env.DB.batch([
        env.DB.prepare(`UPDATE player_resident_relations SET exchange_day = ?, exchange_token = ?, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND gift_day IS NOT NULL AND exchange_day IS NULL AND EXISTS
            (SELECT 1 FROM player_items WHERE user_id = ? AND item_key = 'item-wood' AND placed_at IS NULL)
          RETURNING exchange_day`).bind(today.world_day, claim, user.id, user.id),
        env.DB.prepare(`UPDATE player_items SET quantity = CASE WHEN quantity > 1 THEN quantity - 1 ELSE quantity END,
          placed_at = CASE WHEN quantity > 1 THEN NULL ELSE CURRENT_TIMESTAMP END, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND item_key = 'item-wood' AND placed_at IS NULL AND EXISTS
            (SELECT 1 FROM player_resident_relations WHERE user_id = ? AND exchange_token = ?)`)
          .bind(user.id, user.id, claim),
        env.DB.prepare(`INSERT INTO player_items (user_id, item_key, quantity, first_picked_day, placed_at)
          SELECT ?, 'item-windseed', 1, ?, NULL WHERE EXISTS
            (SELECT 1 FROM player_resident_relations WHERE user_id = ? AND exchange_token = ?)
          ON CONFLICT(user_id, item_key) DO UPDATE SET quantity = CASE
            WHEN player_items.placed_at IS NULL THEN player_items.quantity + 1 ELSE 1 END,
            placed_at = NULL, updated_at = CURRENT_TIMESTAMP`)
          .bind(user.id, today.world_day, user.id, claim),
      ])
      if (results[0].meta.changes) return json({ exchange: true,
        message: '木材を小川の住人に渡し、風の種を受け取りました。庭に植えるか、持って歩けます。' })
      return json({ message: '小川の住人は木材を探しています。倒木から採って持っていけます。' })
    }
    const revisit = today.world_day >= 80 && relation.exchange_day < today.world_day && !relation.revisit_day
      ? await env.DB.prepare(`UPDATE player_resident_relations SET revisit_day = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND revisit_day IS NULL RETURNING revisit_day`).bind(today.world_day, user.id).first() : null
    return json({ remembered: true, revisited: Boolean(revisit), message: revisit
      ? '小川の住人は木材と種の交換を覚えています。「あの種は、どこへ運ばれたでしょう」。再訪の記録が残りました。'
      : '小川の住人は交換した木材を使い、流れの音を静かに聞いています。' })
  }

  if (url.pathname === '/api/stream-fishing' && request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return json({ error: 'このページから操作してください。' }, 403)
    const today = await publishedDay(env)
    if (!today || today.world_day < 67) return json({ error: '小川にはまだ魚影がありません。' }, 409)
    const input = await request.json<{ x?: number; y?: number }>()
    const x = Number(input.x)
    const y = Number(input.y)
    const size = mapSize(today.world_day)
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || y < 1 || x >= size.width - 1 || y >= size.height - 1) {
      return json({ error: 'そこからは届きません。' }, 400)
    }
    const fish = await env.DB.prepare(`SELECT x, y FROM world_entities WHERE entity_key = 'stream-fish'
      AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?)`)
      .bind(today.world_day, today.world_day).first<{ x: number; y: number }>()
    if (!fish || Math.abs(x - fish.x) + Math.abs(y - fish.y) > 1) return json({ error: '小川の魚影へ近づいてください。' }, 409)
    if (today.world_day < 68) return json({ state: 'idle', message: '細い魚影が流れに逆らって泳ぎ、石の陰へ戻りました。' })
    const user = await currentUser(request, env)
    if (!user) return json({ state: 'idle', message: '魚影を見守りました。記録を始めると、また来たときに通り道を比べられます。' })
    await recordFieldObservation(env, user.id, today.world_day, 'stream-fish')
    const observed = await env.DB.prepare(`INSERT OR IGNORE INTO player_stream_fishing
      (user_id, first_seen_day, world_day) VALUES (?, ?, ?)`)
      .bind(user.id, today.world_day, today.world_day).run()
    if (observed.meta.changes) return json({ state: 'idle', observed: true,
      message: '流れに逆らう細い魚影を、釣らずに観察記録へ残しました。' })
    await env.DB.prepare(`UPDATE player_stream_fishing SET state = 'idle', world_day = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND world_day < ?`).bind(today.world_day, user.id, today.world_day).run()
    const record = await env.DB.prepare('SELECT first_seen_day, state, released_day, revisit_day FROM player_stream_fishing WHERE user_id = ?')
      .bind(user.id).first<{ first_seen_day: number; state: 'idle' | 'cast' | 'caught'; released_day: number | null; revisit_day: number | null }>()
    if (today.world_day >= 70 && record?.released_day && record.released_day < today.world_day && !record.revisit_day) {
      const revisit = await env.DB.prepare(`UPDATE player_stream_fishing SET revisit_day = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND revisit_day IS NULL RETURNING revisit_day`).bind(today.world_day, user.id).first()
      if (revisit) return json({ state: 'idle', revisited: true,
        message: '前に戻した魚影が、今日も同じ石の陰から流れへ泳ぎ出しました。再訪の記録を残しました。' })
    }
    if (today.world_day < 69) return json({ state: 'idle', message: '細い魚影は流れに逆らい、池の魚とは違う通り道を泳ぎます。' })
    const rod = await env.DB.prepare('SELECT rod_borrowed FROM player_fishing WHERE user_id = ?')
      .bind(user.id).first<{ rod_borrowed: number }>()
    if (!rod?.rod_borrowed) return json({ state: 'idle', message: '魚影を見守りました。釣るなら池のそばで竿を借りてください。' })
    if (record?.state === 'idle') {
      const cast = await env.DB.prepare(`UPDATE player_stream_fishing SET state = 'cast', updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND state = 'idle' RETURNING state`).bind(user.id).first()
      if (cast) return json({ state: 'cast', message: '小川へ糸を垂らしました。流れの中で浮きが揺れています。' })
    } else if (record?.state === 'cast') {
      const caught = await env.DB.prepare(`UPDATE player_stream_fishing SET state = 'caught', updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND state = 'cast' RETURNING state`).bind(user.id).first()
      if (caught) return json({ state: 'caught', message: '細い魚が釣れました。もう一度アクションすると小川へ戻せます。' })
    } else if (record?.state === 'caught') {
      const released = await env.DB.prepare(`UPDATE player_stream_fishing SET state = 'idle', released_day = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND state = 'caught' RETURNING released_day`).bind(today.world_day, user.id).first()
      if (released) return json({ state: 'idle', released: true,
        message: '魚を小川へ戻しました。細い影が流れをさかのぼり、石の陰へ消えます。' })
    }
    return json({ error: 'もう一度、魚影を見てください。' }, 409)
  }

  if (url.pathname === '/api/field-guide' && request.method === 'GET') {
    const today = await publishedDay(env)
    if (!today || today.world_day < 89) return json({ entries: [] })
    const user = await currentUser(request, env)
    if (!user) return json({ entries: [] })
    const entries = await env.DB.prepare(`SELECT subjects.subject_key AS key, subjects.label,
      observations.first_seen_day AS firstSeenDay, observations.first_note AS note,
      CASE WHEN entities.gone_day IS NOT NULL AND entities.gone_day <= ? THEN 1 ELSE 0 END AS absent
      FROM player_field_observations AS observations
      JOIN field_subjects AS subjects ON subjects.subject_key = observations.subject_key
      JOIN world_entities AS entities ON entities.entity_key = subjects.entity_key
      WHERE observations.user_id = ? ORDER BY observations.first_seen_day, subjects.subject_key`)
      .bind(today.world_day, user.id).all()
    return json({ entries: entries.results.map(row => ({ ...row, absent: Boolean(row.absent) })) })
  }

  if (url.pathname === '/api/field-observe' && request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return json({ error: 'このページから操作してください。' }, 403)
    const today = await publishedDay(env)
    if (!today || today.world_day < 86) return json({ error: '羽虫はまだいません。' }, 409)
    const input = await request.json<{ key?: string; x?: number; y?: number }>()
    if (input.key !== 'stream-mayfly' && input.key !== 'mayfly-trace') return json({ error: '観察するものを選んでください。' }, 400)
    const subject = await env.DB.prepare("SELECT * FROM field_subjects WHERE subject_key = 'stream-mayfly'").first<FieldSubject>()
    if (!subject) return json({ error: '観察対象がありません。' }, 404)
    const currentKey = input.key
    const fromTrace = currentKey === subject.trace_key
    const entity = await env.DB.prepare(`SELECT x, y FROM world_entities WHERE entity_key = ?
      AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?)`).bind(currentKey, today.world_day, today.world_day)
      .first<{ x: number; y: number }>()
    if (!entity) return json({ error: '今はそこに姿がありません。' }, 404)
    const x = Number(input.x)
    const y = Number(input.y)
    const size = mapSize(today.world_day)
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || y < 1 || x >= size.width - 1 || y >= size.height - 1 ||
      Math.abs(x - entity.x) + Math.abs(y - entity.y) > subject.observe_distance) {
      return json({ error: 'もう少し近づいてください。' }, 409)
    }
    const user = await currentUser(request, env)
    const discovered = user ? await recordFieldObservation(env, user.id, today.world_day, subject.subject_key, fromTrace) : false
    return json({ observed: Boolean(user && today.world_day >= 88), discovered,
      message: fromTrace ? `羽虫の姿は見えません。${discovered ? '羽の跡から、かつていたことを図鑑に残しました。' : '水辺に薄い羽の跡があります。'}`
        : `${fieldNote(subject, today.world_day)}${discovered ? ' 初めての発見を図鑑に残しました。' : ''}` })
  }

  if (url.pathname === '/api/source-action' && request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return json({ error: 'このページから操作してください。' }, 403)
    const user = await currentUser(request, env)
    if (!user) return json({ error: '採るには検証用の記録を始めてください。' }, 401)
    const input = await request.json<{ key?: string; x?: number; y?: number }>()
    const today = await publishedDay(env)
    if (!today || today.world_day < 16) return json({ error: 'まだ実るものはありません。' }, 400)
    const x = Number(input.x)
    const y = Number(input.y)
    const size = mapSize(today.world_day)
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || y < 1 || x >= size.width - 1 || y >= size.height - 1) {
      return json({ error: 'そこからは届きません。' }, 400)
    }
    const source = await env.DB.prepare(`SELECT entity_key, label, x, y, width, height FROM world_entities
      WHERE entity_key = ? AND kind = 'source' AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?)`)
      .bind(input.key ?? '', today.world_day, today.world_day).first<{ entity_key: string; label: string; x: number; y: number; width: number; height: number }>()
    if (!source) return json({ error: 'そこからは採れません。' }, 404)
    if (today.world_day < 20 && source.entity_key !== 'source-fruit-tree') return json({ error: 'そこから採れるのは、もう少し先です。' }, 409)
    const dx = Math.max(source.x - x, 0, x - source.x - source.width + 1)
    const dy = Math.max(source.y - y, 0, y - source.y - source.height + 1)
    if (dx + dy > 1) return json({ error: 'もう少し近づいてください。' }, 409)
    if (source.entity_key === 'source-hill-stone') {
      const terrain = await terrainAt(env, source.x, source.y, today.world_day)
      if (today.world_day < 65 || terrain.kind !== 'hill' || terrain.elevation !== 1) return json({ error: '丘の石はまだ採れません。' }, 409)
    }
    if (source.entity_key === 'source-field-grass') {
      const tool = await env.DB.prepare("SELECT 1 FROM player_items WHERE user_id = ? AND item_key = 'item-tool' AND placed_at IS NULL")
        .bind(user.id).first()
      if (!tool) return json({ error: '草を束ねるには、物置の小さな道具が必要です。' }, 409)
    }
    if (source.entity_key === 'source-tool-shed') {
      const borrowed = await env.DB.prepare("SELECT item_key FROM player_items WHERE user_id = ? AND item_key = 'item-tool' AND placed_at IS NULL")
        .bind(user.id).first()
      if (borrowed) return json({ ok: true, message: '道具は手元にあります。岩や倒木に使えます。' })
    }
    const held = await env.DB.prepare('SELECT COALESCE(SUM(quantity), 0) AS total FROM player_items WHERE user_id = ? AND placed_at IS NULL')
      .bind(user.id).first<{ total: number }>()
    if ((held?.total ?? 0) >= 5) return json({ error: '持てるものは5つまでです。' }, 429)
    const sourceOutputs: Record<string, string> = {
      'source-fruit-tree': 'item-berry',
      'source-tool-shed': 'item-tool',
      'source-reed-bed': 'item-reed',
      'source-clay-pit': 'item-clay',
      'source-wildflower': 'item-wildflower',
      'source-sandbank': 'item-sand',
      'source-conifer': 'item-cone',
      'source-root-bed': 'item-root',
      'source-bark-tree': 'item-bark',
      'source-seedling': 'item-seedling',
      'source-lichen-rock': 'item-lichen',
      'source-lateberry': 'item-lateberry',
      'source-mirror-stone': 'item-mirrorpebble',
      'source-windplant': 'item-windseed',
      'source-seed-pod': 'item-seed',
      'source-hill-stone': 'item-ore',
      'source-field-grass': 'item-field-fiber',
    }
    const now = new Date()
    const climate = worldClimate(today.world_day, now)
    const rainMirror = source.entity_key === 'source-lichen-rock' && rainMirrorAvailable(today.world_day, now)
    const outputKey = rainMirror ? 'item-mirrorpebble' : sourceOutputs[source.entity_key] ?? 'item-sprout'
    await env.DB.prepare(`INSERT INTO player_items (user_id, item_key, quantity, first_picked_day, placed_at)
      VALUES (?, ?, 1, ?, NULL) ON CONFLICT(user_id, item_key) DO UPDATE SET
        quantity = CASE WHEN player_items.placed_at IS NULL THEN player_items.quantity + 1 ELSE 1 END,
        placed_at = NULL, updated_at = CURRENT_TIMESTAMP`)
      .bind(user.id, outputKey, today.world_day).run()
    return json({ ok: true, message: source.entity_key === 'source-tool-shed'
      ? '小さな道具を借りました。岩や倒木に使えます。'
      : source.entity_key === 'source-hill-stone' ? '丘の石から石のかけらを採りました。木材と組み合わせて作業台で使えます。'
      : source.entity_key === 'source-field-grass' ? '道具で外の草から繊維を採りました。木材と一緒に作業台へ持っていけます。'
      : source.entity_key === 'source-lichen-rock' && today.world_day >= 85
        ? rainMirror ? '雨の夕暮れの石から鏡石を採りました。持ち物から庭に置けます。'
          : `石から地衣類を採りました。${climate.weather === 'rain' ? '雨が上がる前の明るい時間です。' : '雨の夕暮れには別のものが見つかりそうです。'}`
      : `${source.label}から${source.entity_key === 'source-fruit-tree' ? '実り' : '素材'}を採りました。` })
  }

  if (url.pathname === '/api/craft' && request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return json({ error: 'このページから操作してください。' }, 403)
    const user = await currentUser(request, env)
    if (!user) return json({ error: '作るには検証用の記録を始めてください。' }, 401)
    const input = await request.json<{ x?: number; y?: number }>()
    const today = await publishedDay(env)
    if (!today || today.world_day < 28) return json({ error: 'まだ作れるものはありません。' }, 409)
    const x = Number(input.x)
    const y = Number(input.y)
    const size = mapSize(today.world_day)
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || y < 1 || x >= size.width - 1 || y >= size.height - 1) {
      return json({ error: 'そこからは届きません。' }, 400)
    }
    const [workbench, recipes, held, craftedRows] = await Promise.all([
      env.DB.prepare(`SELECT x, y, width, height FROM world_entities WHERE entity_key = 'workbench'
        AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?)`)
        .bind(today.world_day, today.world_day).first<{ x: number; y: number; width: number; height: number }>(),
      env.DB.prepare('SELECT recipe_key, label, ingredient_a, ingredient_b, output_key FROM craft_recipes WHERE born_day <= ? ORDER BY born_day DESC')
        .bind(today.world_day).all<{ recipe_key: string; label: string; ingredient_a: string; ingredient_b: string; output_key: string }>(),
      env.DB.prepare('SELECT item_key FROM player_items WHERE user_id = ? AND placed_at IS NULL')
        .bind(user.id).all<{ item_key: string }>(),
      env.DB.prepare('SELECT recipe_key FROM player_crafts WHERE user_id = ?')
        .bind(user.id).all<{ recipe_key: string }>(),
    ])
    if (!workbench || !recipes.results.length) return json({ error: '作業台はまだありません。' }, 404)
    const dx = Math.max(workbench.x - x, 0, x - workbench.x - workbench.width + 1)
    const dy = Math.max(workbench.y - y, 0, y - workbench.y - workbench.height + 1)
    if (dx + dy > 1) return json({ error: '作業台へ近づいてください。' }, 409)
    const heldKeys = new Set(held.results.map(item => item.item_key))
    const craftedKeys = new Set(craftedRows.results.map(row => row.recipe_key))
    const recipe = recipes.results.find(row => !craftedKeys.has(row.recipe_key) && heldKeys.has(row.ingredient_a) && heldKeys.has(row.ingredient_b))
    if (!recipe) return json({ error: today.world_day >= 96 ? '石と木材、または外の草の繊維と木材が必要です。' : '石のかけらと木材が必要です。' }, 409)
    const claim = randomToken()
    const results = await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO player_crafts (user_id, recipe_key, claim_token, world_day)
        SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM player_items WHERE user_id = ? AND item_key = ?)
        AND EXISTS (SELECT 1 FROM player_items WHERE user_id = ? AND item_key = ? AND placed_at IS NULL)
        AND EXISTS (SELECT 1 FROM player_items WHERE user_id = ? AND item_key = ? AND placed_at IS NULL)`)
        .bind(user.id, recipe.recipe_key, claim, today.world_day, user.id, recipe.output_key,
          user.id, recipe.ingredient_a, user.id, recipe.ingredient_b),
      env.DB.prepare(`UPDATE player_items SET quantity = CASE WHEN quantity > 1 THEN quantity - 1 ELSE quantity END,
        placed_at = CASE WHEN quantity > 1 THEN NULL ELSE CURRENT_TIMESTAMP END, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND item_key = ? AND placed_at IS NULL
        AND EXISTS (SELECT 1 FROM player_crafts WHERE user_id = ? AND recipe_key = ? AND claim_token = ?)`)
        .bind(user.id, recipe.ingredient_a, user.id, recipe.recipe_key, claim),
      env.DB.prepare(`UPDATE player_items SET quantity = CASE WHEN quantity > 1 THEN quantity - 1 ELSE quantity END,
        placed_at = CASE WHEN quantity > 1 THEN NULL ELSE CURRENT_TIMESTAMP END, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND item_key = ? AND placed_at IS NULL
        AND EXISTS (SELECT 1 FROM player_crafts WHERE user_id = ? AND recipe_key = ? AND claim_token = ?)`)
        .bind(user.id, recipe.ingredient_b, user.id, recipe.recipe_key, claim),
      env.DB.prepare(`INSERT INTO player_items (user_id, item_key, quantity, first_picked_day, placed_at)
        SELECT ?, ?, 1, ?, NULL WHERE EXISTS (
          SELECT 1 FROM player_crafts WHERE user_id = ? AND recipe_key = ? AND claim_token = ?)`)
        .bind(user.id, recipe.output_key, today.world_day, user.id, recipe.recipe_key, claim),
    ])
    if (!results[0].meta.changes) {
      const crafted = await env.DB.prepare('SELECT recipe_key FROM player_crafts WHERE user_id = ? AND recipe_key = ?')
        .bind(user.id, recipe.recipe_key).first()
      return json({ error: crafted ? `${recipe.label}はすでに作りました。` : '材料をもう一度確かめてください。' }, 409)
    }
    return json({ ok: true, message: `${recipe.label}を作りました。最初の庭に置けます。` })
  }

  if (url.pathname.startsWith('/api/world-history/') && request.method === 'GET') {
    const dayText = url.pathname.slice('/api/world-history/'.length)
    if (!/^[1-9]\d*$/.test(dayText)) return json({ error: '世界日を指定してください。' }, 400)
    const day = Number(dayText)
    if (!Number.isSafeInteger(day)) return json({ error: '世界日を指定してください。' }, 400)
    const row = await env.DB.prepare(`SELECT snapshots.source, snapshots.snapshot_json AS snapshotJson
      FROM world_snapshots AS snapshots JOIN world_days AS days ON days.world_day = snapshots.world_day
      WHERE snapshots.world_day = ? AND days.status = 'published'
        AND (? IS NULL OR snapshots.world_day <= ?)`).bind(day, env.APP_MODE === 'day1' ? 1 : null, env.APP_MODE === 'day1' ? 1 : null)
      .first<{ source: 'reconstructed' | 'captured'; snapshotJson: string }>()
    if (!row) return json({ error: 'その日の記録はありません。' }, 404)
    return json({ source: row.source, snapshot: JSON.parse(row.snapshotJson) }, 200,
      { 'cache-control': 'public, max-age=86400' })
  }

  if (url.pathname === '/api/world' && request.method === 'GET') {
    const today = await publishedDay(env)
    if (!today) return json({ error: 'まだ世界がありません。' }, 503)
    const viewer = await currentUser(request, env)
    const size = mapSize(today.world_day)

    // Everything is pinned to the published day, so one visit never mixes two days together.
    const [entities, tiles, picked, traces, gardenTiles, decorations, flower, priorCare, ecology, east, streamRelease] = await Promise.all([
      env.DB.prepare(`SELECT entity_key AS key, kind, x, y, width, height, sprite, label, message, panel, flat, blocks
        FROM world_entities WHERE born_day <= ?1 AND (gone_day IS NULL OR gone_day > ?1) ORDER BY y, x`)
        .bind(today.world_day).all<Record<string, unknown>>(),
      env.DB.prepare(`SELECT x, y, kind, elevation, traversal FROM world_tiles
        WHERE born_day <= ?1 AND (gone_day IS NULL OR gone_day > ?1)`)
        .bind(today.world_day).all<Record<string, unknown>>(),
      viewer ? env.DB.prepare('SELECT item_key FROM player_items WHERE user_id = ?').bind(viewer.id).all<{ item_key: string }>() : Promise.resolve({ results: [] as { item_key: string }[] }),
      today.world_day >= 9 ? env.DB.prepare(`SELECT traces.id, traces.item_key, traces.x, traces.y, world_entities.label, world_entities.sprite
        FROM traces JOIN world_entities ON world_entities.entity_key = traces.item_key
        WHERE traces.world_day <= ? AND traces.expires_at > datetime('now') ORDER BY traces.id`).bind(today.world_day).all<{ id: number; item_key: string; x: number; y: number; label: string; sprite: string }>() : Promise.resolve({ results: [] as { id: number; item_key: string; x: number; y: number; label: string; sprite: string }[] }),
      viewer ? env.DB.prepare(`SELECT x, y, CASE WHEN status = 'watered' AND ? >= 20
        AND datetime(updated_at, '+90 seconds') <= CURRENT_TIMESTAMP THEN 'grown' ELSE status END AS kind
        FROM player_garden_tiles WHERE user_id = ?`).bind(today.world_day, viewer.id).all<Record<string, unknown>>() : Promise.resolve({ results: [] as Record<string, unknown>[] }),
      viewer && today.world_day >= 29 ? env.DB.prepare('SELECT item_key, x, y FROM player_decorations WHERE user_id = ? AND world_day <= ?')
        .bind(viewer.id, today.world_day).all<{ item_key: string; x: number; y: number }>()
        : Promise.resolve({ results: [] as { item_key: string; x: number; y: number }[] }),
      viewer && today.world_day >= 42 ? env.DB.prepare('SELECT flower_tended, flower_color FROM player_insects WHERE user_id = ?')
        .bind(viewer.id).first<{ flower_tended: number; flower_color: string }>() : Promise.resolve(null),
      viewer && today.world_day >= 46 ? env.DB.prepare(`SELECT prepared_day, flower_color, garden_x, garden_y
        FROM player_habitat_care WHERE user_id = ? AND prepared_day < ?
        ORDER BY prepared_day DESC LIMIT 1`).bind(viewer.id, today.world_day)
        .first<{ prepared_day: number; flower_color: string; garden_x: number; garden_y: number }>() : Promise.resolve(null),
      viewer && today.world_day >= 53 ? env.DB.prepare(`SELECT nest_seen_day, feather_seen_day
        FROM player_ecology_observations WHERE user_id = ?`).bind(viewer.id)
        .first<{ nest_seen_day: number | null; feather_seen_day: number | null }>() : Promise.resolve(null),
      viewer && today.world_day >= 55 ? env.DB.prepare('SELECT first_day FROM player_east_observations WHERE user_id = ?')
        .bind(viewer.id).first<{ first_day: number }>() : Promise.resolve(null),
      viewer && today.world_day >= 74 ? env.DB.prepare('SELECT released_day FROM player_stream_fishing WHERE user_id = ?')
        .bind(viewer.id).first<{ released_day: number | null }>() : Promise.resolve(null),
    ])
    const pickedKeys = new Set(picked.results.map(item => item.item_key))
    const traceEntities = traces.results.map(trace => ({
      key: `trace-${trace.id}`, kind: 'trace', x: trace.x, y: trace.y, width: 1, height: 1,
      sprite: trace.sprite, label: '誰かの置いた跡', message: `${trace.label}が、ここに置かれていました。`,
      panel: null, flat: false, blocks: false,
    }))
    const decorationEntities = decorations.results.map(decoration => ({
      key: `decoration-${decoration.item_key}`, kind: 'decoration', x: decoration.x, y: decoration.y,
      width: 1, height: 1, sprite: decoration.item_key === 'item-reed' ? 'map-reeds map-placed-reed' : decoration.item_key === 'item-field-bundle' ? 'map-field-bundle' : 'map-lantern',
      label: decoration.item_key === 'item-reed' ? '池のそばの葦' : decoration.item_key === 'item-field-bundle' ? '草と木の束' : '小さな灯り',
      message: decoration.item_key === 'item-reed'
        ? 'あなたが水辺から採って置いた葦です。池のそばで揺れています。'
        : decoration.item_key === 'item-field-bundle' ? '外の草と村の木を組み合わせ、庭に置いた束です。次に来たときもここにあります。'
        : 'あなたが作って置いた灯りです。次に来たときも、ここにあります。',
      panel: null, flat: false, blocks: false,
    }))
    const tendedTile = viewer && today.world_day >= 37
      ? gardenTiles.results.find(row => row.kind === 'watered' || row.kind === 'grown') : null
    const visitorTile = priorCare ? { x: priorCare.garden_x, y: priorCare.garden_y } : tendedTile
    const gardenVisitor = visitorTile ? [{
      key: 'garden-visitor', kind: 'creature', x: Number(visitorTile.x), y: Number(visitorTile.y),
      width: 1, height: 1, sprite: priorCare && flower?.flower_tended && east
        ? 'map-garden-visitor care-return linked-visit' : priorCare ? 'map-garden-visitor care-return' : 'map-garden-visitor', label: '庭の小さな訪問者',
      message: priorCare && flower?.flower_tended && east
        ? '花と庭の水、東の泉の気配がつながり、小さな訪問者が戻ってきました。'
        : priorCare
        ? `DAY ${priorCare.prepared_day} に整えた${priorCare.flower_color === 'yellow' ? '黄色' : '白色'}の花と水を覚えて、小さな生き物が庭へ戻ってきました。`
        : '水をやった庭に、小さな生き物が来ています。あなたの世話した場所を選んだようです。',
      panel: null, flat: false, blocks: false,
    }] : []
    const fruitVisitor = flower?.flower_tended ? [{
      key: 'fruit-visitor', kind: 'creature', x: 4, y: 4, width: 1, height: 1,
      sprite: 'map-fruit-visitor', label: '果樹に来た虫',
      message: `${flower.flower_color === 'yellow' ? '黄色' : '白色'}の花を整えたあと、果樹に小さな虫が来ました。花と実の間を行き来しています。`,
      panel: null, flat: false, blocks: false,
    }] : []
    const feather = ecology?.nest_seen_day && ecology.nest_seen_day < today.world_day ? [{
      key: 'east-feather', kind: 'ecology', x: 13, y: 16, width: 1, height: 1,
      sprite: ecology.feather_seen_day ? 'map-east-feather feather-seen' : 'map-east-feather',
      label: '巣のそばの羽', message: '小鳥が巣と泉を行き来した跡です。',
      panel: null, flat: false, blocks: false,
    }] : []

    return json({
      worldDay: today.world_day,
      oracle: today.oracle,
      climate: today.world_day >= 81 ? worldClimate(today.world_day) : null,
      map: size,
      entities: [...entities.results.filter(row => row.kind !== 'item' || !pickedKeys.has(String(row.key))).map(row => ({
        ...row,
        message: row.key === 'workbench' && today.world_day >= 96
          ? '石と木材で灯りを、外の草の繊維と木材で草と木の束を作れます。' : row.message,
        sprite: row.key === 'stream-dragonfly' && streamRelease?.released_day ? `${String(row.sprite)} linked-flight` : row.sprite,
        flat: Boolean(row.flat),
        blocks: Boolean(row.blocks),
      })), ...traceEntities, ...decorationEntities, ...gardenVisitor, ...fruitVisitor, ...feather],
      tiles: [...tiles.results, ...gardenTiles.results],
    })
  }

  if (url.pathname === '/api/diary' && request.method === 'GET') {
    // The ledger of days drives the diary, so a day the god stayed silent still has its place.
    const entries = await env.DB.prepare(`SELECT days.world_day AS worldDay, COALESCE(diary.body, days.oracle) AS body,
      CASE WHEN days.screenshot_key IS NULL THEN NULL ELSE '/api/screenshots/' || days.world_day END AS screenshotUrl,
      days.published_at AS publishedAt
      FROM world_days AS days LEFT JOIN genesis_diary AS diary ON diary.world_day = days.world_day
      WHERE days.status = 'published' AND (? IS NULL OR days.world_day <= ?)
      ORDER BY days.world_day DESC`).bind(env.APP_MODE === 'day1' ? 1 : null, env.APP_MODE === 'day1' ? 1 : null).all()
    return json({ entries: entries.results })
  }

  if (url.pathname.startsWith('/api/screenshots/') && request.method === 'GET') {
    const worldDay = Number(url.pathname.split('/').at(-1))
    const row = await env.DB.prepare("SELECT screenshot_key FROM world_days WHERE world_day = ? AND status = 'published'")
      .bind(worldDay).first<{ screenshot_key: string | null }>()
    if (!row?.screenshot_key) return new Response('Not found', { status: 404 })
    const object = await env.SCREENSHOTS.get(row.screenshot_key)
    if (!object) return new Response('Not found', { status: 404 })
    return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType ?? 'image/png', 'cache-control': 'public, max-age=86400' } })
  }

  if (url.pathname === '/api/wishes' && request.method === 'POST') {
    const user = await currentUser(request, env)
    if (!user) return json({ error: '願うにはログインしてください。' }, 401)
    const input = await request.json<{ body?: string; publicConsent?: boolean }>()
    const body = input.body?.trim() ?? ''
    if (!isPreview(env) && !input.publicConsent) return json({ error: '公開への同意が必要です。' }, 400)
    if (!body || body.length > 280) return json({ error: '願いは1〜280文字で書いてください。' }, 400)
    const recent = await env.DB.prepare("SELECT id FROM wishes WHERE user_id = ? AND created_at > datetime('now', '-7 days')").bind(user.id).first()
    if (recent) return json({ error: '次に願える日を待ってください。' }, 429)
    if (isPreview(env)) {
      await env.DB.prepare('INSERT INTO wishes (user_id, body, issue_number, issue_url) VALUES (?, ?, 0, ?)')
        .bind(user.id, body, '').run()
      return json({ issueUrl: null }, 201)
    }
    const issueResponse = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'hakoniwa-worker' },
      body: JSON.stringify({ title: `願い：${body.replaceAll(/[\r\n]+/g, ' ').slice(0, 48)}`, body: `${body}\n\n---\nHAKONIWAの願いの掲示板から届きました。`, labels: ['wish'] }),
    })
    if (!issueResponse.ok) return json({ error: '願いを届けられませんでした。' }, 502)
    const issue = await issueResponse.json<{ number: number; html_url: string }>()
    await env.DB.prepare('INSERT INTO wishes (user_id, body, issue_number, issue_url) VALUES (?, ?, ?, ?)')
      .bind(user.id, body, issue.number, issue.html_url).run()
    return json({ issueUrl: issue.html_url }, 201)
  }

  return json({ error: 'Not found' }, 404)
}

/**
 * Moves the world on by one day. The new day is built as a draft and only becomes
 * visible once everything it needs exists, so a failure part way through leaves
 * observers on yesterday's world rather than on half of today's.
 */
async function advanceDay(env: Env) {
  const current = await env.DB.prepare('SELECT world_day, status FROM world_days ORDER BY world_day DESC LIMIT 1')
    .first<{ world_day: number; status: 'draft' | 'published' }>()
  if (!current) return null
  if (current.status !== 'published') {
    console.error(JSON.stringify({ event: 'world_advance_blocked', worldDay: current.world_day, status: current.status }))
    return null
  }
  const nextDay = current.world_day + 1

  const approved = await env.DB.prepare(`SELECT id, proposal_json AS proposalJson FROM world_creation_proposals
    WHERE target_world_day = ? AND source_world_day = ? AND status = 'approved'`)
    .bind(nextDay, current.world_day).first<{ id: number; proposalJson: string }>()
  if (!approved) {
    console.error(JSON.stringify({ event: 'world_advance_blocked', worldDay: current.world_day,
      targetWorldDay: nextDay, reason: 'no-approved-proposal' }))
    return null
  }

  const source = await env.DB.prepare('SELECT snapshot_json AS snapshotJson FROM world_snapshots WHERE world_day = ?')
    .bind(current.world_day).first<{ snapshotJson: string }>()
  if (!source) throw new Error(`missing source snapshot for DAY ${current.world_day}`)
  const sourceSnapshot = JSON.parse(source.snapshotJson) as SharedWorldSnapshot
  const run = await createApprovedProposalRun(sourceSnapshot, mapSize(nextDay), JSON.parse(approved.proposalJson))
  const transition = JSON.stringify(run.transition)

  // D1 batches are transactional. The final status update invokes the
  // migration trigger that compares the captured snapshot with this run's
  // expected output; a mismatch rolls back the draft, event and publication.
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`INSERT INTO world_days (world_day, oracle, status)
      SELECT ?, ?, 'draft' WHERE EXISTS (
        SELECT 1 FROM world_creation_proposals WHERE id = ? AND status = 'approved' AND proposal_json = ?
      )`).bind(nextDay, run.proposal.oracle, approved.id, approved.proposalJson),
    env.DB.prepare(`INSERT INTO world_creation_runs
      (world_day, source_world_day, algorithm, proposal_json, seed, transition_json,
        expected_snapshot_json, input_snapshot_sha256, output_snapshot_sha256)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        nextDay, current.world_day, run.algorithm, JSON.stringify(run.proposal), run.seed,
        transition, JSON.stringify(run.expectedSnapshot), run.transition.beforeSha256, run.transition.afterSha256,
      ),
  ]
  if (run.proposal.kind === 'creation') {
    for (const operation of run.proposal.operations) {
      if (operation.kind === 'add_entity') {
        const entity = operation.value
        statements.push(env.DB.prepare(`INSERT INTO world_entities
          (entity_key, kind, x, y, width, height, sprite, label, message, panel, flat, blocks, born_day)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
            entity.key, entity.kind, entity.x, entity.y, entity.width, entity.height, entity.sprite,
            entity.label, entity.message, entity.panel, Number(entity.flat), Number(entity.blocks), nextDay,
          ))
      } else {
        const tile = operation.value
        statements.push(env.DB.prepare(`INSERT INTO world_tiles
          (x, y, kind, born_day, elevation, traversal) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(tile.x, tile.y, tile.kind, nextDay, tile.elevation, tile.traversal))
      }
    }
    statements.push(env.DB.prepare(`INSERT INTO creation_events (world_day, kind, payload)
      VALUES (?, 'approved_proposal_applied', ?)`).bind(nextDay,
        JSON.stringify({ proposalId: approved.id, algorithm: run.algorithm, seed: run.seed, title: run.proposal.title })))
  } else {
    statements.push(env.DB.prepare("INSERT INTO creation_events (world_day, kind, payload) VALUES (?, 'silence', ?)")
      .bind(nextDay, JSON.stringify({ proposalId: approved.id, algorithm: run.algorithm,
        seed: run.seed, reason: run.proposal.reason })))
  }
  statements.push(
    env.DB.prepare("UPDATE world_days SET status = 'published', published_at = CURRENT_TIMESTAMP WHERE world_day = ?")
      .bind(nextDay),
    env.DB.prepare(`UPDATE world_creation_runs SET status = 'published', published_at = CURRENT_TIMESTAMP
      WHERE world_day = ?`).bind(nextDay),
  )
  statements.push(env.DB.prepare(`UPDATE world_creation_proposals
    SET status = 'applied', applied_at = CURRENT_TIMESTAMP, applied_run_day = ?
    WHERE id = ? AND status = 'approved'`).bind(nextDay, approved.id))
  await env.DB.batch(statements)

  return nextDay
}

async function captureToday(env: Env) {
  const current = await publishedDay(env)
  if (!current) return
  const browser = await launch(env.BROWSER)
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`${env.PUBLIC_ORIGIN}/?capture=1`, { waitUntil: 'networkidle' })
    const screenshot = await page.screenshot({ type: 'png' })
    const key = `world-days/day-${String(current.world_day).padStart(4, '0')}.png`
    await env.SCREENSHOTS.put(key, screenshot, { httpMetadata: { contentType: 'image/png' } })
    await env.DB.prepare('UPDATE world_days SET screenshot_key = ? WHERE world_day = ?')
      .bind(key, current.world_day).run()
  } finally {
    await browser.close()
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    const response = url.pathname.startsWith('/api/') ? await api(request, env, url) : await env.ASSETS.fetch(request)
    if (!isPreview(env)) return response
    const previewResponse = new Response(response.body, response)
    previewResponse.headers.set('x-robots-tag', 'noindex, nofollow')
    return previewResponse
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (isPreview(env)) return
    ctx.waitUntil((async () => {
      // Until the first day is released, the world holds at Day 1 and only its picture is retaken.
      if (await setting(env, 'daily_advance') === 'on') {
        const day = await advanceDay(env).catch(error => {
          console.error('advance failed', error)
          return null
        })
        if (day) console.log(JSON.stringify({ event: 'world_day_advanced', worldDay: day }))
      }
      // A failed capture must not stop the world; it is logged so the day can be retried.
      await captureToday(env).catch(error => console.error('capture failed', error))
    })())
  },
} satisfies ExportedHandler<Env>
