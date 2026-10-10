import { launch } from '@cloudflare/playwright'

interface Env {
  ASSETS: Fetcher
  DB: D1Database
  SCREENSHOTS: R2Bucket
  BROWSER: Fetcher
  PUBLIC_ORIGIN: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  GITHUB_TOKEN: string
  GITHUB_OWNER: string
  GITHUB_REPO: string
  APP_MODE?: 'day1' | 'evolution'
}

type User = { id: number; email: string; display_name: string; avatar_url: string | null }

// The first expansion opens on Day 22; the later small region opens on Day 48.
const MAP_WIDTH = 12
const MAP_HEIGHT = 12
const mapSize = (worldDay: number) => worldDay >= 48 ? { width: 18, height: 18 } : worldDay >= 22 ? { width: 16, height: 16 } : { width: MAP_WIDTH, height: MAP_HEIGHT }

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
    const held = await env.DB.prepare(`SELECT player_items.item_key FROM player_items
      WHERE user_id = ? AND item_key = ? AND placed_at IS NULL`).bind(user.id, itemKey).first()
    if (!held) return json({ error: '手に持っているものがありません。' }, 409)
    if (itemKey === 'item-lantern' || (itemKey === 'item-reed' && today.world_day >= 38)) {
      if (itemKey === 'item-lantern' && today.world_day < 29) return json({ error: '灯りを置けるのは DAY 29 からです。' }, 409)
      if (itemKey === 'item-lantern' && (x > 10 || y > 10)) return json({ error: '灯りは最初の庭に置いてください。' }, 409)
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
      if (!results[0].meta.changes) return json({ error: itemKey === 'item-lantern' ? '灯りはすでに庭にあります。' : '葦はすでに池のそばにあります。' }, 409)
      return json({ ok: true, decoration: true, message: itemKey === 'item-lantern'
        ? '小さな灯りを庭に置きました。次に来たときも、ここにあります。'
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
    const [occupied, path] = await Promise.all([
      env.DB.prepare(`SELECT entity_key FROM world_entities WHERE x <= ? AND x + width > ? AND y <= ? AND y + height > ?
        AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?) LIMIT 1`)
        .bind(x, x, y, y, today.world_day, today.world_day).first(),
      env.DB.prepare(`SELECT kind FROM world_tiles WHERE x = ? AND y = ? AND kind = 'path'
        AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?) LIMIT 1`)
        .bind(x, y, today.world_day, today.world_day).first(),
    ])
    if (occupied || path) return json({ error: 'その場所には植えられません。' }, 409)
    const tile = await env.DB.prepare('SELECT status, seed_key, updated_at FROM player_garden_tiles WHERE user_id = ? AND x = ? AND y = ?')
      .bind(user.id, x, y).first<{ status: string; seed_key: string | null; updated_at: string }>()
    if (!tile) {
      await env.DB.prepare(`INSERT INTO player_garden_tiles (user_id, x, y, status) VALUES (?, ?, ?, 'tilled')`).bind(user.id, x, y).run()
      return json({ ok: true, state: 'tilled', message: '土を耕しました。' })
    }
    if (tile.status === 'tilled') {
      if (today.world_day < 18) return json({ error: '実を植えられるのは DAY 18 からです。' }, 409)
      const seed = await env.DB.prepare(`SELECT item_key FROM player_items WHERE user_id = ? AND placed_at IS NULL
        AND item_key IN ('item-seed', 'item-berry', 'item-sprout')
        ORDER BY CASE item_key WHEN 'item-berry' THEN 0 WHEN 'item-seed' THEN 1 ELSE 2 END LIMIT 1`)
        .bind(user.id).first<{ item_key: string }>()
      if (!seed) return json({ error: '植える種を持っていません。' }, 409)
      await env.DB.prepare(`UPDATE player_items SET quantity = CASE WHEN quantity > 1 THEN quantity - 1 ELSE quantity END,
        placed_at = CASE WHEN quantity > 1 THEN NULL ELSE CURRENT_TIMESTAMP END, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND item_key = ? AND placed_at IS NULL`).bind(user.id, seed.item_key).run()
      await env.DB.prepare(`UPDATE player_garden_tiles SET status = 'planted', seed_key = ?, planted_day = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND x = ? AND y = ?`)
        .bind(seed.item_key, today.world_day, user.id, x, y).run()
      return json({ ok: true, state: 'planted', message: '種を植えました。' })
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
    }
    const outputKey = sourceOutputs[source.entity_key] ?? 'item-sprout'
    await env.DB.prepare(`INSERT INTO player_items (user_id, item_key, quantity, first_picked_day, placed_at)
      VALUES (?, ?, 1, ?, NULL) ON CONFLICT(user_id, item_key) DO UPDATE SET
        quantity = CASE WHEN player_items.placed_at IS NULL THEN player_items.quantity + 1 ELSE 1 END,
        placed_at = NULL, updated_at = CURRENT_TIMESTAMP`)
      .bind(user.id, outputKey, today.world_day).run()
    return json({ ok: true, message: source.entity_key === 'source-tool-shed'
      ? '小さな道具を借りました。岩や倒木に使えます。'
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
    const [workbench, recipe] = await Promise.all([
      env.DB.prepare(`SELECT x, y, width, height FROM world_entities WHERE entity_key = 'workbench'
        AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?)`)
        .bind(today.world_day, today.world_day).first<{ x: number; y: number; width: number; height: number }>(),
      env.DB.prepare("SELECT recipe_key, label, ingredient_a, ingredient_b, output_key FROM craft_recipes WHERE recipe_key = 'lantern' AND born_day <= ?")
        .bind(today.world_day).first<{ recipe_key: string; label: string; ingredient_a: string; ingredient_b: string; output_key: string }>(),
    ])
    if (!workbench || !recipe) return json({ error: '作業台はまだありません。' }, 404)
    const dx = Math.max(workbench.x - x, 0, x - workbench.x - workbench.width + 1)
    const dy = Math.max(workbench.y - y, 0, y - workbench.y - workbench.height + 1)
    if (dx + dy > 1) return json({ error: '作業台へ近づいてください。' }, 409)
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
      return json({ error: crafted ? '灯りはすでに作りました。' : '石のかけらと木材が必要です。' }, 409)
    }
    return json({ ok: true, message: `${recipe.label}を作りました。DAY 29から最初の庭に置けます。` })
  }

  if (url.pathname === '/api/world' && request.method === 'GET') {
    const today = await publishedDay(env)
    if (!today) return json({ error: 'まだ世界がありません。' }, 503)
    const viewer = await currentUser(request, env)
    const size = mapSize(today.world_day)

    // Everything is pinned to the published day, so one visit never mixes two days together.
    const [entities, tiles, picked, traces, gardenTiles, decorations, flower, priorCare] = await Promise.all([
      env.DB.prepare(`SELECT entity_key AS key, kind, x, y, width, height, sprite, label, message, panel, flat, blocks
        FROM world_entities WHERE born_day <= ?1 AND (gone_day IS NULL OR gone_day > ?1) ORDER BY y, x`)
        .bind(today.world_day).all<Record<string, unknown>>(),
      env.DB.prepare(`SELECT x, y, kind FROM world_tiles
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
    ])
    const pickedKeys = new Set(picked.results.map(item => item.item_key))
    const traceEntities = traces.results.map(trace => ({
      key: `trace-${trace.id}`, kind: 'trace', x: trace.x, y: trace.y, width: 1, height: 1,
      sprite: trace.sprite, label: '誰かの置いた跡', message: `${trace.label}が、ここに置かれていました。`,
      panel: null, flat: false, blocks: false,
    }))
    const decorationEntities = decorations.results.map(decoration => ({
      key: `decoration-${decoration.item_key}`, kind: 'decoration', x: decoration.x, y: decoration.y,
      width: 1, height: 1, sprite: decoration.item_key === 'item-reed' ? 'map-reeds map-placed-reed' : 'map-lantern',
      label: decoration.item_key === 'item-reed' ? '池のそばの葦' : '小さな灯り',
      message: decoration.item_key === 'item-reed'
        ? 'あなたが水辺から採って置いた葦です。池のそばで揺れています。'
        : 'あなたが作って置いた灯りです。次に来たときも、ここにあります。',
      panel: null, flat: false, blocks: false,
    }))
    const tendedTile = viewer && today.world_day >= 37
      ? gardenTiles.results.find(row => row.kind === 'watered' || row.kind === 'grown') : null
    const visitorTile = priorCare ? { x: priorCare.garden_x, y: priorCare.garden_y } : tendedTile
    const gardenVisitor = visitorTile ? [{
      key: 'garden-visitor', kind: 'creature', x: Number(visitorTile.x), y: Number(visitorTile.y),
      width: 1, height: 1, sprite: priorCare ? 'map-garden-visitor care-return' : 'map-garden-visitor', label: '庭の小さな訪問者',
      message: priorCare
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

    return json({
      worldDay: today.world_day,
      oracle: today.oracle,
      map: size,
      entities: [...entities.results.filter(row => row.kind !== 'item' || !pickedKeys.has(String(row.key))).map(row => ({
        ...row,
        flat: Boolean(row.flat),
        blocks: Boolean(row.blocks),
      })), ...traceEntities, ...decorationEntities, ...gardenVisitor, ...fruitVisitor],
      tiles: [...tiles.results, ...gardenTiles.results],
    })
  }

  if (url.pathname === '/api/diary' && request.method === 'GET') {
    // The ledger of days drives the diary, so a day the god stayed silent still has its place.
    const entries = await env.DB.prepare(`SELECT days.world_day AS worldDay, diary.body,
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
  const current = await env.DB.prepare('SELECT world_day FROM world_days ORDER BY world_day DESC LIMIT 1')
    .first<{ world_day: number }>()
  if (!current) return null
  const nextDay = current.world_day + 1

  // Nothing proposes creations yet, so every new day is a silence until one does.
  await env.DB.prepare("INSERT INTO world_days (world_day, oracle, status) VALUES (?, NULL, 'draft')")
    .bind(nextDay).run()
  await env.DB.prepare("INSERT INTO creation_events (world_day, kind, payload) VALUES (?, 'silence', '{}')")
    .bind(nextDay).run()
  await env.DB.prepare("UPDATE world_days SET status = 'published', published_at = CURRENT_TIMESTAMP WHERE world_day = ?")
    .bind(nextDay).run()

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
        if (day) console.log('world day advanced', day)
      }
      // A failed capture must not stop the world; it is logged so the day can be retried.
      await captureToday(env).catch(error => console.error('capture failed', error))
    })())
  },
} satisfies ExportedHandler<Env>
