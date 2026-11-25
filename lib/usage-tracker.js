import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDataDir, writeJsonAtomic } from './config-store.js'

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const MAX_EVENTS_PER_PROVIDER = 4000
const RETENTION_MS = 35 * 24 * 60 * 60 * 1000

export function mapDshProviderToFamily(providerId, modelId = '') {
  const p = String(providerId || '').toLowerCase()
  const m = String(modelId || '').toLowerCase()
  if (p === 'agy' || p.startsWith('agy-') || p.includes('antigravity') || p.includes('gemini') || p === 'google') return 'gemini'
  if (p === 'mistral' || p === 'mistral-pro' || p.startsWith('mistral-')) return 'mistral'
  if (p.includes('anthropic') || p.includes('claude')) return 'claude'
  if (p.includes('openai') || p.includes('chatgpt') || p.includes('codex')) return 'chatgpt'
  if (m.startsWith('gemini-')) return 'gemini'
  if (m.startsWith('claude-')) return 'claude'
  if (m.startsWith('mistral-') || m.startsWith('devstral')) return 'mistral'
  return null
}

function emptyStore() {
  return {
    version: 1,
    events: {
      chatgpt: [],
      claude: [],
      gemini: [],
      mistral: [],
    },
    lastQuotaError: {
      chatgpt: null,
      claude: null,
      gemini: null,
      mistral: null,
    },
  }
}

function normalizeStore(raw) {
  const base = emptyStore()
  if (!raw || typeof raw !== 'object') return base
  const ev = raw.events && typeof raw.events === 'object' ? raw.events : {}
  const err = raw.lastQuotaError && typeof raw.lastQuotaError === 'object' ? raw.lastQuotaError : {}
  for (const key of Object.keys(base.events)) {
    if (Array.isArray(ev[key])) {
      base.events[key] = ev[key]
        .filter((e) => e && typeof e.at === 'number' && Number.isFinite(e.at))
        .slice(-MAX_EVENTS_PER_PROVIDER)
    }
    if (err[key] && typeof err[key] === 'object' && typeof err[key].at === 'number') {
      base.lastQuotaError[key] = {
        at: err[key].at,
        code: typeof err[key].code === 'string' ? err[key].code : 'QUOTA',
        message: typeof err[key].message === 'string' ? err[key].message.slice(0, 200) : '',
      }
    }
  }
  return base
}

export function createUsageTracker(options = {}) {
  const dataDir = options.dataDir || resolveDataDir()
  const trackerFile = join(dataDir, 'tracker.json')
  let store = load()
  let saveTimer = null
  let dirty = false

  function load() {
    try {
      const raw = readFileSync(trackerFile, 'utf8')
      return normalizeStore(JSON.parse(raw))
    } catch {
      return emptyStore()
    }
  }

  function prune(nowMs) {
    const cutoff = nowMs - RETENTION_MS
    for (const key of Object.keys(store.events)) {
      const list = store.events[key]
      const filtered = list.filter((item) => item.at >= cutoff)
      store.events[key] = filtered.length > MAX_EVENTS_PER_PROVIDER ? filtered.slice(-MAX_EVENTS_PER_PROVIDER) : filtered
    }
  }

  function scheduleSave() {
    dirty = true
    if (saveTimer !== null) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      flush()
    }, 1500)
    saveTimer.unref?.()
  }

  function flush() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (!dirty) return
    dirty = false
    try {
      prune(Date.now())
      writeJsonAtomic(trackerFile, store)
    } catch {
      // Best-effort local tracker persistence.
    }
  }

  function recordUsage({ provider, model = '', inputTokens = 0, outputTokens = 0, totalTokens = 0, at = Date.now() }) {
    const family = mapDshProviderToFamily(provider, model)
    if (!family) return false
    const inTok = Number.isFinite(inputTokens) && inputTokens > 0 ? Math.round(inputTokens) : 0
    const outTok = Number.isFinite(outputTokens) && outputTokens > 0 ? Math.round(outputTokens) : 0
    const tot = Number.isFinite(totalTokens) && totalTokens > 0 ? Math.round(totalTokens) : inTok + outTok
    store.events[family].push({
      at,
      model: typeof model === 'string' ? model.slice(0, 80) : '',
      inputTokens: inTok,
      outputTokens: outTok,
      totalTokens: tot,
    })
    if (store.events[family].length > MAX_EVENTS_PER_PROVIDER) {
      store.events[family] = store.events[family].slice(-MAX_EVENTS_PER_PROVIDER)
    }
    scheduleSave()
    return true
  }

  function recordQuotaError({ provider, model = '', code = 'QUOTA_EXCEEDED', message = '', at = Date.now() }) {
    const family = mapDshProviderToFamily(provider, model)
    if (!family) return false
    store.lastQuotaError[family] = {
      at,
      code: String(code || 'QUOTA_EXCEEDED').slice(0, 60),
      message: String(message || '').slice(0, 200),
    }
    scheduleSave()
    return true
  }

  function summarize(family, nowMs = Date.now()) {
    const list = store.events[family] || []
    const startOfDay = new Date(nowMs)
    startOfDay.setHours(0, 0, 0, 0)
    const dayStartMs = startOfDay.getTime()

    const startOfMonth = new Date(nowMs)
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)
    const monthStartMs = startOfMonth.getTime()

    const acc = {
      last5h: { requests: 0, tokens: 0, inputTokens: 0, outputTokens: 0 },
      today: { requests: 0, tokens: 0, inputTokens: 0, outputTokens: 0 },
      last7d: { requests: 0, tokens: 0, inputTokens: 0, outputTokens: 0 },
      thisMonth: { requests: 0, tokens: 0, inputTokens: 0, outputTokens: 0 },
    }

    for (const item of list) {
      const add = (bucket) => {
        bucket.requests += 1
        bucket.tokens += item.totalTokens || 0
        bucket.inputTokens += item.inputTokens || 0
        bucket.outputTokens += item.outputTokens || 0
      }
      if (item.at >= nowMs - FIVE_HOURS_MS) add(acc.last5h)
      if (item.at >= dayStartMs) add(acc.today)
      if (item.at >= nowMs - SEVEN_DAYS_MS) add(acc.last7d)
      if (item.at >= monthStartMs) add(acc.thisMonth)
    }

    const lastErr = store.lastQuotaError[family]
    const recentQuotaError = lastErr && nowMs - lastErr.at < FIVE_HOURS_MS ? lastErr : null

    return {
      ...acc,
      recentQuotaError,
      lastEventAt: list.length > 0 ? list[list.length - 1].at : null,
    }
  }

  return {
    trackerFile,
    recordUsage,
    recordQuotaError,
    summarize,
    flush,
  }
}
