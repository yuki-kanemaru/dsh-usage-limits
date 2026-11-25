/**
 * dsh-usage-limits — Host plugin half.
 *
 * Fetches usage limits for ChatGPT, Claude, Gemini (Antigravity), and Mistral,
 * tracks DSH local fallback usage via `session/event` (`request/context` +
 * `assistant/message` + `assistant/attempt`), manages optional Mistral Admin
 * cookie via DSH credentials store, and serves authenticated same-origin HTTP
 * routes for the left sidebar footer widget and detail panel.
 */
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { createConfigStore, PROVIDER_IDS } from './lib/config-store.js'
import { readRequestBody } from './lib/http-body.js'
import { createUsageTracker } from './lib/usage-tracker.js'
import { inspectAgyHook, installAgyHook, uninstallAgyHook } from './lib/agy-hook-setup.js'
import { fetchChatGptQuota } from './lib/providers/chatgpt.js'
import { fetchClaudeQuota } from './lib/providers/claude.js'
import { fetchGeminiQuota } from './lib/providers/gemini.js'
import { fetchMistralQuota } from './lib/providers/mistral.js'

export const name = 'dsh-usage-limits'
const ROUTE_PREFIX = '/_dsh/dsh-usage-limits'
const LOG_TAG = '[dsh-usage-limits]'

function respondJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

function disabledProviderSnapshot(id, nowMs = Date.now()) {
  return {
    id,
    enabled: false,
    status: 'disabled',
    source: 'none',
    plan: null,
    fetchedAt: nowMs,
    stale: false,
    windows: [],
    credits: null,
    spend: null,
    error: null,
  }
}

export function createUsageLimitsService(options = {}) {
  const configStore = createConfigStore({ dataDir: options.dataDir })
  const tracker = createUsageTracker({ dataDir: configStore.dataDir })
  const getCredentials = typeof options.getCredentials === 'function' ? options.getCredentials : () => undefined
  const getDetectedGeminiPlan = typeof options.getDetectedGeminiPlan === 'function' ? options.getDetectedGeminiPlan : () => null
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : fetch

  const lastSnapshots = new Map()
  const lastGoodSnapshots = new Map()
  const inFlight = new Map()
  let lastAgyCacheMtimeMs = 0

  function readAgyCacheMtimeMs() {
    try {
      const st = statSync(join(configStore.dataDir, 'agy-quota-cache.json'))
      return Number.isFinite(st.mtimeMs) ? st.mtimeMs : 0
    } catch {
      return 0
    }
  }

  function hasNewerAgyCache() {
    const mtime = readAgyCacheMtimeMs()
    return mtime > 0 && mtime !== lastAgyCacheMtimeMs
  }

  function mergeWithStale(id, next) {
    if (next.status === 'ok' && (next.windows.length > 0 || next.credits || next.spend || next.source === 'statusline')) {
      lastGoodSnapshots.set(id, next)
      lastSnapshots.set(id, next)
      return next
    }
    if ((next.status === 'error' || next.status === 'rate_limited') && next.windows.length === 0) {
      const good = lastGoodSnapshots.get(id)
      if (good && good.windows.length > 0) {
        const merged = {
          ...good,
          fetchedAt: next.fetchedAt,
          stale: true,
          status: next.status === 'rate_limited' ? 'rate_limited' : good.status,
          error: next.error,
        }
        lastSnapshots.set(id, merged)
        return merged
      }
    }
    lastSnapshots.set(id, next)
    return next
  }

  async function refreshOne(id) {
    const cfg = configStore.get()
    const pCfg = cfg.providers[id]
    if (!pCfg || pCfg.enabled !== true) {
      const snap = disabledProviderSnapshot(id)
      lastSnapshots.set(id, snap)
      return snap
    }

    if (inFlight.has(id)) {
      return inFlight.get(id)
    }

    const run = (async () => {
      try {
        const credentials = getCredentials()
        let result
        if (id === 'chatgpt') {
          result = await fetchChatGptQuota({ fetchImpl })
        } else if (id === 'claude') {
          result = await fetchClaudeQuota({ fetchImpl, credentials })
        } else if (id === 'gemini') {
          const mtimeBefore = readAgyCacheMtimeMs()
          result = await fetchGeminiQuota({
            dataDir: configStore.dataDir,
            providerConfig: pCfg,
            trackerSummary: tracker.summarize('gemini'),
            detectedPlan: getDetectedGeminiPlan(),
          })
          lastAgyCacheMtimeMs = mtimeBefore
        } else if (id === 'mistral') {
          result = await fetchMistralQuota({
            fetchImpl,
            credentials,
            providerConfig: pCfg,
            trackerSummary: tracker.summarize('mistral'),
          })
        } else {
          return disabledProviderSnapshot(id)
        }
        return mergeWithStale(id, result)
      } catch (err) {
        return mergeWithStale(id, {
          id,
          enabled: true,
          status: 'error',
          source: 'none',
          plan: null,
          fetchedAt: Date.now(),
          stale: false,
          windows: [],
          credits: null,
          spend: null,
          error: {
            code: 'INTERNAL_ERROR',
            message: err instanceof Error ? err.message : 'Unexpected provider error.',
          },
        })
      } finally {
        inFlight.delete(id)
      }
    })()

    inFlight.set(id, run)
    return run
  }

  async function refresh(targetProvider) {
    if (targetProvider && PROVIDER_IDS.includes(targetProvider)) {
      await refreshOne(targetProvider)
      return getSnapshot()
    }
    await Promise.allSettled(PROVIDER_IDS.map((id) => refreshOne(id)))
    return getSnapshot()
  }

  function getSnapshot() {
    const cfg = configStore.get()
    const providers = {}
    for (const id of PROVIDER_IDS) {
      const enabled = cfg.providers[id]?.enabled === true
      if (!enabled) {
        providers[id] = disabledProviderSnapshot(id)
      } else if (lastSnapshots.has(id)) {
        const snap = lastSnapshots.get(id)
        if (id === 'gemini' || id === 'mistral') {
          providers[id] = { ...snap, tracker: tracker.summarize(id) }
        } else {
          providers[id] = snap
        }
      } else {
        providers[id] = {
          id,
          enabled: true,
          status: 'loading',
          source: 'none',
          plan: null,
          fetchedAt: null,
          stale: false,
          windows: [],
          credits: null,
          spend: null,
          error: null,
        }
      }
    }
    return {
      ok: true,
      config: cfg,
      providers,
      order: PROVIDER_IDS,
      agyHook: inspectAgyHook({ dataDir: configStore.dataDir }),
      serverTime: Date.now(),
    }
  }

  async function updateConfig(patch) {
    const prev = configStore.get()
    const next = configStore.update(patch)
    const newlyEnabled = PROVIDER_IDS.filter(
      (id) => next.providers[id]?.enabled === true && prev.providers[id]?.enabled !== true,
    )
    if (newlyEnabled.length > 0) {
      await Promise.allSettled(newlyEnabled.map((id) => refreshOne(id)))
    }
    if (
      next.providers.gemini.budget5hTokens !== prev.providers.gemini.budget5hTokens ||
      next.providers.gemini.budgetWeeklyTokens !== prev.providers.gemini.budgetWeeklyTokens
    ) {
      await refreshOne('gemini')
    }
    if (
      next.providers.mistral.budgetMonthlyTokens !== prev.providers.mistral.budgetMonthlyTokens ||
      next.providers.mistral.adminBaseURL !== prev.providers.mistral.adminBaseURL ||
      next.providers.mistral.apiBaseURL !== prev.providers.mistral.apiBaseURL
    ) {
      await refreshOne('mistral')
    }
    return getSnapshot()
  }

  async function setMistralCookie(cookieValue) {
    const credentials = getCredentials()
    const ref = configStore.get().providers.mistral.adminCookieEnv || 'MISTRAL_ADMIN_COOKIE'
    if (!credentials || typeof credentials.set !== 'function' || typeof credentials.unset !== 'function') {
      return { ok: false, error: 'DSH credentials service is unavailable.' }
    }
    const trimmed = typeof cookieValue === 'string' ? cookieValue.trim() : ''
    if (!trimmed) {
      await credentials.unset(ref)
    } else {
      await credentials.set(ref, trimmed)
    }
    await refreshOne('mistral')
    return {
      ok: true,
      configured: Boolean(trimmed),
      snapshot: getSnapshot(),
    }
  }

  async function manageAgyHook(action, force = false) {
    let outcome
    if (action === 'install') {
      outcome = installAgyHook({ force, dataDir: configStore.dataDir })
    } else if (action === 'uninstall') {
      outcome = uninstallAgyHook({ dataDir: configStore.dataDir })
    } else {
      outcome = { ok: true, ...inspectAgyHook({ dataDir: configStore.dataDir }) }
    }
    await refreshOne('gemini')
    return {
      ...outcome,
      snapshot: getSnapshot(),
    }
  }

  return {
    configStore,
    tracker,
    getSnapshot,
    refresh,
    refreshOne,
    hasNewerAgyCache,
    updateConfig,
    setMistralCookie,
    manageAgyHook,
  }
}

function resolveRouteFromSession(session, routeCache) {
  const id = session?.id
  if (id && routeCache.has(id)) return routeCache.get(id)
  const events = Array.isArray(session?.events) ? session.events : null
  if (!events) return null
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]
    if (ev && ev.type === 'request/context' && ev.data && typeof ev.data.provider === 'string') {
      const route = { provider: ev.data.provider, model: typeof ev.data.model === 'string' ? ev.data.model : '' }
      if (id) routeCache.set(id, route)
      return route
    }
  }
  return null
}

export function apply(ctx) {
  const getCredentials = () => {
    try {
      return ctx.get('credentials', false)
    } catch {
      return undefined
    }
  }

  const getDetectedGeminiPlan = () => {
    try {
      const llm = ctx.get('llm', false)
      if (!llm || typeof llm.listProviders !== 'function') return null
      const list = llm.listProviders()
      const agy = Array.isArray(list) ? list.find((p) => p && (p.id === 'agy-acp' || String(p.id || '').includes('agy'))) : null
      return agy?.displayName || null
    } catch {
      return null
    }
  }

  const service = createUsageLimitsService({
    getCredentials,
    getDetectedGeminiPlan,
  })

  // Auto-repair legacy Windows quoted hook commands written by earlier versions.
  try {
    const hookState = inspectAgyHook({ dataDir: service.configStore.dataDir })
    if (hookState.needsRepair) {
      installAgyHook({ dataDir: service.configStore.dataDir })
    }
  } catch {
    // Non-fatal; user can still repair via settings UI.
  }

  // Track DSH session events accurately using the real `(session, event)` signature.
  const sessionRoutes = new Map()
  try {
    ctx.on('session/event', (session, event) => {
      try {
        if (!event || typeof event !== 'object') return
        const type = event.type
        const data = event.data && typeof event.data === 'object' ? event.data : null
        if (!data) return

        if (type === 'request/context' && typeof data.provider === 'string') {
          if (session?.id) {
            sessionRoutes.set(session.id, {
              provider: data.provider,
              model: typeof data.model === 'string' ? data.model : '',
            })
          }
          return
        }

        if (type === 'assistant/message' && data.usage && typeof data.usage === 'object') {
          const route = resolveRouteFromSession(session, sessionRoutes)
          if (!route) return
          const u = data.usage
          const inputTokens = Number(u.inputTokens ?? u.input_tokens ?? u.prompt_tokens ?? 0) || 0
          const outputTokens = Number(u.outputTokens ?? u.output_tokens ?? u.completion_tokens ?? 0) || 0
          const cacheRead = Number(u.cacheReadTokens ?? u.cache_read_input_tokens ?? 0) || 0
          const cacheWrite = Number(u.cacheWriteTokens ?? u.cache_creation_input_tokens ?? 0) || 0
          const totalTokens = Number(u.totalTokens ?? u.total_tokens ?? inputTokens + outputTokens + cacheRead + cacheWrite) || 0
          if (totalTokens > 0) {
            service.tracker.recordUsage({
              provider: route.provider,
              model: route.model,
              inputTokens: inputTokens + cacheRead + cacheWrite,
              outputTokens,
              totalTokens,
              at: typeof event.time === 'number' ? event.time : Date.now(),
            })
          }
          return
        }

        if (type === 'assistant/attempt' && Array.isArray(data.stream)) {
          const route = resolveRouteFromSession(session, sessionRoutes)
          if (!route) return
          for (const rec of data.stream) {
            if (!rec || typeof rec !== 'object') continue
            const errObj = rec.error || rec.failure
            const code = String(errObj?.code || rec.code || '')
            if (code.includes('QUOTA') || code.includes('RATE_LIMIT') || code === '429') {
              service.tracker.recordQuotaError({
                provider: route.provider,
                model: route.model,
                code,
                message: String(errObj?.message || rec.message || ''),
                at: typeof event.time === 'number' ? event.time : Date.now(),
              })
              break
            }
          }
        }
      } catch {
        // Never disrupt session event delivery.
      }
    })

    ctx.on('session/disposed', (session) => {
      if (session?.id) sessionRoutes.delete(session.id)
    })
  } catch {
    // Optional listener.
  }

  let lastPollAt = 0
  ctx.effect(() => {
    void service.refresh()
    lastPollAt = Date.now()
    const timer = setInterval(() => {
      const intervalMs = (service.configStore.get().refreshIntervalSec || 180) * 1000
      if (Date.now() - lastPollAt >= intervalMs) {
        lastPollAt = Date.now()
        void service.refresh()
      } else if (service.hasNewerAgyCache()) {
        void service.refreshOne('gemini')
      }
    }, 15000)
    timer.unref?.()
    return () => {
      clearInterval(timer)
      sessionRoutes.clear()
      service.tracker.flush()
    }
  }, 'dsh-usage-limits: background refresh')

  const ROUTES = {
    status: async () => {
      const snap = service.getSnapshot()
      const anyLoading = PROVIDER_IDS.some((id) => snap.providers[id]?.status === 'loading')
      if (anyLoading) {
        return service.refresh()
      }
      if (service.hasNewerAgyCache()) {
        await service.refreshOne('gemini')
        return service.getSnapshot()
      }
      return snap
    },
    refresh: async (args) => {
      const provider = args && typeof args.provider === 'string' ? args.provider : undefined
      return service.refresh(provider)
    },
    config: async (args) => {
      if (!args || typeof args !== 'object') {
        const err = new Error('Config patch object is required.')
        err.status = 400
        throw err
      }
      return service.updateConfig(args)
    },
    'mistral-cookie': async (args) => {
      const cookie = args && typeof args.cookie === 'string' ? args.cookie : ''
      return service.setMistralCookie(cookie)
    },
    'agy-hook': async (args) => {
      const action = args && typeof args.action === 'string' ? args.action : 'inspect'
      const force = Boolean(args && args.force === true)
      return service.manageAgyHook(action, force)
    },
  }

  const MUTATING = new Set(['refresh', 'config', 'mistral-cookie', 'agy-hook'])

  ctx.inject(['connection', 'webServer'], (webCtx) => {
    webCtx.effect(() => {
      try {
        const dispose = webCtx.webServer.register({
          kind: 'prefix',
          path: ROUTE_PREFIX,
          handler: async (req, res) => {
            try {
              const rejection =
                typeof webCtx.connection?.requestRejection === 'function'
                  ? webCtx.connection.requestRejection(req)
                  : undefined
              if (rejection !== undefined) {
                respondJson(res, rejection, {
                  ok: false,
                  error: rejection === 401 ? 'authentication required' : 'request rejected',
                })
                return
              }

              const url = new URL(req.url || '/', 'http://127.0.0.1')
              if (!url.pathname.startsWith(ROUTE_PREFIX + '/')) {
                respondJson(res, 404, { ok: false, error: 'not found' })
                return
              }
              const method = decodeURIComponent(url.pathname.slice(ROUTE_PREFIX.length + 1))
              if (!Object.hasOwn(ROUTES, method)) {
                respondJson(res, 404, { ok: false, error: `unknown method: ${method}` })
                return
              }
              if (MUTATING.has(method) && req.method !== 'POST') {
                respondJson(res, 405, { ok: false, error: 'POST required' })
                return
              }

              let args = null
              if (req.method === 'POST') {
                const raw = await readRequestBody(req, 64 * 1024)
                if (raw.length > 0) {
                  try {
                    args = JSON.parse(raw)
                  } catch {
                    respondJson(res, 400, { ok: false, error: 'invalid JSON body' })
                    return
                  }
                }
              }

              const result = await ROUTES[method](args)
              respondJson(res, 200, result)
            } catch (err) {
              const status = err && typeof err.status === 'number' ? err.status : 500
              if (status === 413) {
                try {
                  res.setHeader('connection', 'close')
                } catch {
                  // Ignore header error.
                }
              }
              respondJson(res, status, {
                ok: false,
                error: status === 500 ? 'internal error' : String(err?.message || err),
              })
            }
          },
        })
        return () => dispose()
      } catch (err) {
        console.warn(LOG_TAG, 'webServer route registration failed:', String(err?.message || err))
      }
    }, 'dsh-usage-limits: web routes')
  })
}

export default {
  name,
  apply,
}
