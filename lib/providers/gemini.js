import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inspectAgyHook } from '../agy-hook-setup.js'
import { resolveDataDir } from '../config-store.js'

function clampPct(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10))
}

export function classifyAgyBucket(bucketId) {
  const lower = String(bucketId || '').toLowerCase()
  if (lower.includes('credit')) return 'credit'
  if (
    lower === '3p' ||
    lower.startsWith('3p-') ||
    lower.startsWith('3p_') ||
    lower.includes('claude') ||
    lower.includes('gpt') ||
    lower.includes('openai') ||
    lower.includes('partner') ||
    lower.includes('third')
  ) {
    return 'partner'
  }
  return 'primary'
}

export function formatAgyBucketLabel(bucketId) {
  const raw = String(bucketId || '').trim()
  if (!raw) return 'Quota'
  const lower = raw.toLowerCase()
  if (lower === 'gemini-5h') return 'Gemini 5h'
  if (lower === 'gemini-weekly') return 'Gemini Weekly'
  if (lower === '3p-5h') return '3P (Claude / GPT) 5h'
  if (lower === '3p-weekly') return '3P (Claude / GPT) Weekly'
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
}

export function parseAgyQuotaCache(cacheData, nowMs = Date.now()) {
  if (!cacheData || typeof cacheData !== 'object') return null
  const quotaObj = cacheData.quota && typeof cacheData.quota === 'object' ? cacheData.quota : {}
  const windows = []
  let credits = null

  for (const [bucketId, entry] of Object.entries(quotaObj)) {
    if (!entry || typeof entry !== 'object') continue
    const group = classifyAgyBucket(bucketId)
    const remainingPct =
      typeof entry.remaining_fraction === 'number' && Number.isFinite(entry.remaining_fraction)
        ? clampPct(entry.remaining_fraction * 100)
        : null
    const usedPct = remainingPct !== null ? clampPct(100 - remainingPct) : null
    const remainingAmount =
      typeof entry.remaining_amount === 'number' && Number.isFinite(entry.remaining_amount)
        ? entry.remaining_amount
        : null

    let resetsAt = null
    if (typeof entry.reset_time === 'string' && entry.reset_time.trim() !== '') {
      resetsAt = entry.reset_time.trim()
    } else if (typeof entry.reset_in_seconds === 'number' && Number.isFinite(entry.reset_in_seconds)) {
      const base = typeof cacheData.updatedAt === 'number' ? cacheData.updatedAt : nowMs
      resetsAt = new Date(base + entry.reset_in_seconds * 1000).toISOString()
    }

    if (group === 'credit' && remainingAmount !== null && remainingPct === null) {
      credits = { balance: remainingAmount, currency: 'credits' }
      continue
    }

    if (remainingPct !== null || remainingAmount !== null) {
      windows.push({
        id: bucketId,
        label: formatAgyBucketLabel(bucketId),
        group,
        usedPercent: usedPct,
        remainingPercent: remainingPct,
        remainingAmount,
        unit: remainingAmount !== null ? 'credits' : null,
        resetsAt,
        disabled: entry.disabled === true,
      })
    }
  }

  // Sort primary (Gemini) buckets first, then partner (3P / Claude / GPT), then credits.
  // Within a group, place 5h before weekly.
  const groupOrder = { primary: 0, partner: 1, credit: 2 }
  const windowRank = (id) => {
    const low = String(id || '').toLowerCase()
    if (low.includes('5h')) return 0
    if (low.includes('week')) return 1
    return 2
  }
  windows.sort(
    (a, b) =>
      (groupOrder[a.group] ?? 9) - (groupOrder[b.group] ?? 9) ||
      windowRank(a.id) - windowRank(b.id) ||
      a.id.localeCompare(b.id),
  )

  return {
    updatedAt: typeof cacheData.updatedAt === 'number' ? cacheData.updatedAt : null,
    planTier: typeof cacheData.planTier === 'string' ? cacheData.planTier : null,
    cliVersion: typeof cacheData.cliVersion === 'string' ? cacheData.cliVersion : null,
    windows,
    credits,
  }
}

export async function fetchGeminiQuota(options = {}) {
  const nowMs = typeof options.now === 'number' ? options.now : Date.now()
  const dataDir = options.dataDir || resolveDataDir()
  const cacheFile = options.cacheFile || join(dataDir, 'agy-quota-cache.json')
  const providerConfig = options.providerConfig || {}
  const trackerSummary = options.trackerSummary || null
  const hookInfo = options.hookInfo || inspectAgyHook(options.settingsPath ? { settingsPath: options.settingsPath } : {})

  let cacheParsed = null
  try {
    const raw = readFileSync(cacheFile, 'utf8')
    cacheParsed = parseAgyQuotaCache(JSON.parse(raw), nowMs)
  } catch {
    cacheParsed = null
  }

  const recent429 = Boolean(trackerSummary?.recentQuotaError)
  const windows = []

  if (cacheParsed && cacheParsed.windows.length > 0) {
    windows.push(...cacheParsed.windows)
  } else if (trackerSummary) {
    const b5h = Number(providerConfig.budget5hTokens) || 0
    const bWeek = Number(providerConfig.budgetWeeklyTokens) || 0
    if (b5h > 0) {
      const used = trackerSummary.last5h?.tokens || 0
      const usedPct = clampPct((used / b5h) * 100)
      windows.push({
        id: 'budget-5h',
        label: '5h (est.)',
        group: 'budget',
        usedPercent: usedPct,
        remainingPercent: usedPct === null ? null : clampPct(100 - usedPct),
        used,
        total: b5h,
        unit: 'tokens',
        resetsAt: null,
      })
    }
    if (bWeek > 0) {
      const used = trackerSummary.last7d?.tokens || 0
      const usedPct = clampPct((used / bWeek) * 100)
      windows.push({
        id: 'budget-weekly',
        label: 'weekly (est.)',
        group: 'budget',
        usedPercent: usedPct,
        remainingPercent: usedPct === null ? null : clampPct(100 - usedPct),
        used,
        total: bWeek,
        unit: 'tokens',
        resetsAt: null,
      })
    }
  }

  const hasLiveCache = Boolean(cacheParsed && cacheParsed.windows.length > 0)
  const exhausted = recent429 || windows.some((w) => w.group === 'primary' && w.remainingPercent !== null && w.remainingPercent <= 0)

  return {
    id: 'gemini',
    enabled: true,
    status: exhausted ? 'rate_limited' : 'ok',
    source: hasLiveCache ? 'statusline' : 'tracker',
    plan: cacheParsed?.planTier ? `Google AI ${cacheParsed.planTier}` : options.detectedPlan || 'Antigravity',
    fetchedAt: nowMs,
    stale: false,
    windows,
    credits: cacheParsed?.credits || null,
    spend: null,
    tracker: trackerSummary,
    meta: {
      dashboardUrl: 'https://antigravity.google/docs/cli/commands/usage',
      hookInstalled: Boolean(hookInfo.installed),
      customStatusLinePresent: Boolean(hookInfo.customStatusLinePresent),
      cacheUpdatedAt: cacheParsed?.updatedAt || null,
      hasLiveCache,
    },
    error: null,
  }
}
