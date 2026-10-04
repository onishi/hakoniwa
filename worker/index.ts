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

// The garden still has one size. When regions arrive this comes from the world data too.
const MAP_WIDTH = 12
const MAP_HEIGHT = 12
const mapSize = (worldDay: number) => worldDay >= 48 ? { width: 18, height: 18 } : worldDay >= 28 ? { width: 16, height: 16 } : { width: MAP_WIDTH, height: MAP_HEIGHT }

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
    const items = await env.DB.prepare(`SELECT player_items.item_key AS key, world_entities.label,
      player_items.quantity, player_items.first_picked_day AS firstPickedDay
      FROM player_items LEFT JOIN world_entities ON world_entities.entity_key = player_items.item_key
      WHERE player_items.user_id = ? AND player_items.placed_at IS NULL
      ORDER BY player_items.first_picked_day, player_items.item_key`).bind(user.id).all()
    return json({ items: items.results })
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
    const user = await currentUser(request, env)
    if (!user) return json({ error: '庭を育てるには検証用の記録を始めてください。' }, 401)
    const input = await request.json<{ x?: number; y?: number }>()
    const x = Number(input.x)
    const y = Number(input.y)
    const today = await publishedDay(env)
    if (!today || today.world_day < 12 || !Number.isInteger(x) || !Number.isInteger(y)) return json({ error: 'まだ庭を育てられません。' }, 400)
    const tile = await env.DB.prepare('SELECT status, seed_key FROM player_garden_tiles WHERE user_id = ? AND x = ? AND y = ?')
      .bind(user.id, x, y).first<{ status: string; seed_key: string | null }>()
    if (!tile) {
      await env.DB.prepare(`INSERT INTO player_garden_tiles (user_id, x, y, status) VALUES (?, ?, ?, 'tilled')`).bind(user.id, x, y).run()
      return json({ ok: true, state: 'tilled', message: '土を耕しました。' })
    }
    if (tile.status === 'tilled') {
      const seed = await env.DB.prepare(`SELECT item_key FROM player_items WHERE user_id = ? AND placed_at IS NULL AND item_key IN ('item-seed', 'item-berry') ORDER BY CASE item_key WHEN 'item-seed' THEN 0 ELSE 1 END LIMIT 1`)
        .bind(user.id).first<{ item_key: string }>()
      if (!seed) return json({ error: '植える種を持っていません。' }, 409)
      await env.DB.prepare(`UPDATE player_items SET placed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND item_key = ?`).bind(user.id, seed.item_key).run()
      await env.DB.prepare(`UPDATE player_garden_tiles SET status = 'planted', seed_key = ?, planted_day = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND x = ? AND y = ?`)
        .bind(seed.item_key, today.world_day, user.id, x, y).run()
      return json({ ok: true, state: 'planted', message: '種を植えました。' })
    }
    if (tile.status === 'planted' && today.world_day >= 16) {
      await env.DB.prepare(`UPDATE player_garden_tiles SET status = 'watered', last_watered_day = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND x = ? AND y = ?`)
        .bind(today.world_day, user.id, x, y).run()
      return json({ ok: true, state: 'watered', message: '水をやりました。' })
    }
    if (tile.status === 'watered' && today.world_day >= 18) {
      await env.DB.prepare(`UPDATE player_garden_tiles SET status = 'tilled', seed_key = NULL, planted_day = NULL, last_watered_day = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND x = ? AND y = ?`)
        .bind(user.id, x, y).run()
      await env.DB.prepare(`INSERT INTO player_items (user_id, item_key, quantity, first_picked_day, placed_at)
        VALUES (?, 'item-sprout', 1, ?, NULL)
        ON CONFLICT(user_id, item_key) DO UPDATE SET quantity = quantity + 1, placed_at = NULL, updated_at = CURRENT_TIMESTAMP`)
        .bind(user.id, today.world_day).run()
      return json({ ok: true, state: 'harvested', message: '芽を採りました。' })
    }
    return json({ error: 'もう少し時間が必要です。' }, 409)
  }

  if (url.pathname === '/api/tool-action' && request.method === 'POST') {
    const user = await currentUser(request, env)
    if (!user) return json({ error: '道具を使うには検証用の記録を始めてください。' }, 401)
    const input = await request.json<{ key?: string }>()
    const today = await publishedDay(env)
    if (!today || today.world_day < 33) return json({ error: 'まだ掘ったり割ったりできません。' }, 400)
    const target = await env.DB.prepare(`SELECT entity_key, label FROM world_entities WHERE entity_key = ? AND kind = 'resource' AND born_day <= ?`)
      .bind(input.key ?? '', today.world_day).first<{ entity_key: string; label: string }>()
    if (!target) return json({ error: 'そこには道具を使えません。' }, 404)
    const tool = await env.DB.prepare("SELECT item_key FROM player_items WHERE user_id = ? AND item_key = 'item-tool' AND placed_at IS NULL")
      .bind(user.id).first()
    if (!tool) return json({ error: '使える道具を持っていません。' }, 409)
    const outputKey = target.entity_key === 'resource-rock' ? 'item-ore' : 'item-wood'
    await env.DB.prepare(`INSERT INTO player_items (user_id, item_key, quantity, first_picked_day, placed_at)
      VALUES (?, ?, 1, ?, NULL) ON CONFLICT(user_id, item_key) DO UPDATE SET quantity = quantity + 1, placed_at = NULL, updated_at = CURRENT_TIMESTAMP`)
      .bind(user.id, outputKey, today.world_day).run()
    return json({ ok: true, message: `${target.label}から素材を取り出しました。` })
  }

  if (url.pathname === '/api/source-action' && request.method === 'POST') {
    const user = await currentUser(request, env)
    if (!user) return json({ error: '採るには検証用の記録を始めてください。' }, 401)
    const input = await request.json<{ key?: string }>()
    const today = await publishedDay(env)
    if (!today || today.world_day < 20) return json({ error: 'まだ実るものはありません。' }, 400)
    const source = await env.DB.prepare(`SELECT entity_key, label FROM world_entities
      WHERE entity_key = ? AND kind = 'source' AND born_day <= ? AND (gone_day IS NULL OR gone_day > ?)`)
      .bind(input.key ?? '', today.world_day, today.world_day).first<{ entity_key: string; label: string }>()
    if (!source) return json({ error: 'そこからは採れません。' }, 404)
    const outputKey = source.entity_key === 'source-fruit-tree' ? 'item-berry' : 'item-sprout'
    await env.DB.prepare(`INSERT INTO player_items (user_id, item_key, quantity, first_picked_day, placed_at)
      VALUES (?, ?, 1, ?, NULL) ON CONFLICT(user_id, item_key) DO UPDATE SET quantity = quantity + 1, placed_at = NULL, updated_at = CURRENT_TIMESTAMP`)
      .bind(user.id, outputKey, today.world_day).run()
    return json({ ok: true, message: `${source.label}から実りを採りました。` })
  }

  if (url.pathname === '/api/craft' && request.method === 'POST') {
    const user = await currentUser(request, env)
    if (!user) return json({ error: '作るには検証用の記録を始めてください。' }, 401)
    const today = await publishedDay(env)
    if (!today || today.world_day < 35) return json({ error: 'まだ作れるものはありません。' }, 400)
    const materials = await env.DB.prepare(`SELECT item_key FROM player_items WHERE user_id = ? AND placed_at IS NULL AND item_key IN ('item-ore', 'item-wood')`)
      .bind(user.id).all<{ item_key: string }>()
    const keys = new Set(materials.results.map(row => row.item_key))
    if (!keys.has('item-ore') || !keys.has('item-wood')) return json({ error: '鉱石と木材が必要です。' }, 409)
    for (const key of ['item-ore', 'item-wood']) await env.DB.prepare('UPDATE player_items SET placed_at = CURRENT_TIMESTAMP WHERE user_id = ? AND item_key = ?').bind(user.id, key).run()
    await env.DB.prepare(`INSERT INTO player_items (user_id, item_key, quantity, first_picked_day, placed_at)
      VALUES (?, 'item-lantern', 1, ?, NULL) ON CONFLICT(user_id, item_key) DO UPDATE SET quantity = quantity + 1, placed_at = NULL, updated_at = CURRENT_TIMESTAMP`)
      .bind(user.id, today.world_day).run()
    return json({ ok: true, message: '小さな灯りを作りました。' })
  }

  if (url.pathname === '/api/world' && request.method === 'GET') {
    const today = await publishedDay(env)
    if (!today) return json({ error: 'まだ世界がありません。' }, 503)
    const viewer = await currentUser(request, env)
    const size = mapSize(today.world_day)

    // Everything is pinned to the published day, so one visit never mixes two days together.
    const [entities, tiles, picked, traces, gardenTiles] = await Promise.all([
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
      viewer ? env.DB.prepare('SELECT x, y, status AS kind FROM player_garden_tiles WHERE user_id = ?').bind(viewer.id).all<Record<string, unknown>>() : Promise.resolve({ results: [] as Record<string, unknown>[] }),
    ])
    const pickedKeys = new Set(picked.results.map(item => item.item_key))
    const traceEntities = traces.results.map(trace => ({
      key: `trace-${trace.id}`, kind: 'trace', x: trace.x, y: trace.y, width: 1, height: 1,
      sprite: trace.sprite, label: '誰かの置いた跡', message: `${trace.label}が、ここに置かれていました。`,
      panel: null, flat: false, blocks: false,
    }))

    return json({
      worldDay: today.world_day,
      oracle: today.oracle,
      map: size,
      entities: [...entities.results.filter(row => row.kind !== 'item' || !pickedKeys.has(String(row.key))).map(row => ({
        ...row,
        flat: Boolean(row.flat),
        blocks: Boolean(row.blocks),
      })), ...traceEntities],
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
