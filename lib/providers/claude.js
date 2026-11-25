import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const DEFAULT_TIMEOUT_MS = 8000

function clampPct(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  // Anthropic oauth/usage returns utilization in 0..100 (or occasionally 0..1).
  const normalized = value > 0 && value <= 1 ? value * 100 : value
  return Math.max(0, Math.min(100, Math.round(normalized * 10) / 10))
}

export async function readClaudeOAuthToken(options = {}) {
  const env = options.env || process.env
  const envToken = typeof env.CLAUDE_CODE_OAUTH_TOKEN === 'string' ? env.CLAUDE_CODE_OAUTH_TOKEN.trim() : ''
  if (envToken) {
    return { ok: true, accessToken: envToken, source: 'env', subscriptionType: null }
  }

  const credentials = options.credentials
  if (credentials && typeof credentials.resolve === 'function') {
    try {
      const hit = await credentials.resolve('CLAUDE_CODE_OAUTH_TOKEN')
      if (hit && typeof hit.value === 'string' && hit.value.trim() !== '') {
        return { ok: true, accessToken: hit.value.trim(), source: 'credentials', subscriptionType: null }
      }
    } catch {
      // Ignore credential lookup failure and continue to local file.
    }
  }

  const credFile = options.credentialsFile || join(homedir(), '.claude', '.credentials.json')
  let raw
  try {
    raw = readFileSync(credFile, 'utf8')
  } catch (err) {
    return { ok: false, reason: err && err.code === 'ENOENT' ? 'missing' : 'unreadable' }
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'corrupt' }
  }

  const oauth = parsed?.claudeAiOauth && typeof parsed.claudeAiOauth === 'object' ? parsed.claudeAiOauth : parsed
  const token =
    (typeof oauth?.accessToken === 'string' && oauth.accessToken.trim()) ||
    (typeof oauth?.access_token === 'string' && oauth.access_token.trim()) ||
    null

  if (!token) return { ok: false, reason: 'no_access_token' }

  const subscriptionType =
    (typeof oauth?.subscriptionType === 'string' && oauth.subscriptionType.trim()) ||
    (typeof oauth?.rateLimitTier === 'string' && oauth.rateLimitTier.trim()) ||
    null

  return {
    ok: true,
    accessToken: token,
    source: 'file',
    subscriptionType,
  }
}

export function parseClaudeUsage(payload, fallbackPlan = null) {
  const data = payload && typeof payload === 'object' ? payload : {}
  const windows = []

  const addWindow = (node, id, label, group = 'primary') => {
    if (!node || typeof node !== 'object') return
    const used = clampPct(node.utilization)
    if (used === null) return
    const remaining = clampPct(100 - used)
    const resetsAt = typeof node.resets_at === 'string' && node.resets_at.trim() !== '' ? node.resets_at.trim() : null
    windows.push({
      id,
      label,
      group,
      usedPercent: used,
      remainingPercent: remaining,
      resetsAt,
    })
  }

  addWindow(data.five_hour, '5h', '5h', 'primary')
  addWindow(data.seven_day, '7d', 'weekly', 'primary')
  addWindow(data.seven_day_sonnet, '7d-sonnet', 'Sonnet (7d)', 'partner')
  addWindow(data.seven_day_opus, '7d-opus', 'Opus (7d)', 'partner')

  let spend = null
  if (data.extra_usage && typeof data.extra_usage === 'object' && data.extra_usage.is_enabled === true) {
    const usedCredits = typeof data.extra_usage.used_credits === 'number' ? data.extra_usage.used_credits : null
    const limitCredits = typeof data.extra_usage.monthly_limit === 'number' ? data.extra_usage.monthly_limit : null
    if (usedCredits !== null) {
      spend = { amount: usedCredits / 100, currency: 'USD' }
    }
    if (usedCredits !== null && limitCredits !== null && limitCredits > 0) {
      const usedPct = clampPct((usedCredits / limitCredits) * 100)
      windows.push({
        id: 'extra-usage',
        label: 'Extra usage',
        group: 'budget',
        usedPercent: usedPct,
        remainingPercent: usedPct === null ? null : clampPct(100 - usedPct),
        used: usedCredits / 100,
        total: limitCredits / 100,
        unit: 'USD',
        resetsAt: null,
      })
    }
  }

  const exhausted = windows.some((w) => w.group === 'primary' && w.remainingPercent !== null && w.remainingPercent <= 0)
  return {
    plan: fallbackPlan || null,
    windows,
    spend,
    exhausted,
  }
}

export async function fetchClaudeQuota(options = {}) {
  const nowMs = typeof options.now === 'number' ? options.now : Date.now()
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : fetch
  const usageUrl = options.usageUrl || DEFAULT_USAGE_URL
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS

  const creds = await readClaudeOAuthToken(options)
  if (!creds.ok) {
    return {
      id: 'claude',
      enabled: true,
      status: 'unconfigured',
      source: 'none',
      plan: null,
      fetchedAt: nowMs,
      stale: false,
      windows: [],
      credits: null,
      spend: null,
      meta: {
        dashboardUrl: 'https://claude.ai/settings/usage',
        authFound: false,
      },
      error: {
        code: 'NO_CLAUDE_AUTH',
        message: 'Claude Code OAuth credentials (~/.claude/.credentials.json) were not found. Run `claude login` once installed.',
      },
    }
  }

  let response
  try {
    response = await fetchImpl(usageUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        Accept: 'application/json',
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-code/2.0',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    return {
      id: 'claude',
      enabled: true,
      status: 'error',
      source: 'api',
      plan: creds.subscriptionType,
      fetchedAt: nowMs,
      stale: false,
      windows: [],
      credits: null,
      spend: null,
      meta: {
        dashboardUrl: 'https://claude.ai/settings/usage',
        authFound: true,
      },
      error: {
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : 'Network error while querying Claude usage.',
      },
    }
  }

  if (response.status === 401 || response.status === 403) {
    return {
      id: 'claude',
      enabled: true,
      status: 'auth_expired',
      source: 'api',
      plan: creds.subscriptionType,
      fetchedAt: nowMs,
      stale: false,
      windows: [],
      credits: null,
      spend: null,
      meta: {
        dashboardUrl: 'https://claude.ai/settings/usage',
        authFound: true,
      },
      error: {
        code: 'AUTH_EXPIRED',
        message: `Claude usage endpoint returned HTTP ${response.status}. Run \`claude login\` to refresh credentials.`,
      },
    }
  }

  if (response.status === 429) {
    return {
      id: 'claude',
      enabled: true,
      status: 'rate_limited',
      source: 'api',
      plan: creds.subscriptionType,
      fetchedAt: nowMs,
      stale: false,
      windows: [],
      credits: null,
      spend: null,
      meta: {
        dashboardUrl: 'https://claude.ai/settings/usage',
        authFound: true,
      },
      error: {
        code: 'RATE_LIMITED',
        message: 'Claude usage endpoint rate-limited the request (HTTP 429).',
      },
    }
  }

  if (!response.ok) {
    return {
      id: 'claude',
      enabled: true,
      status: 'error',
      source: 'api',
      plan: creds.subscriptionType,
      fetchedAt: nowMs,
      stale: false,
      windows: [],
      credits: null,
      spend: null,
      meta: {
        dashboardUrl: 'https://claude.ai/settings/usage',
        authFound: true,
      },
      error: {
        code: 'HTTP_ERROR',
        message: `Claude usage endpoint returned HTTP ${response.status}.`,
      },
    }
  }

  let body
  try {
    body = await response.json()
  } catch {
    return {
      id: 'claude',
      enabled: true,
      status: 'error',
      source: 'api',
      plan: creds.subscriptionType,
      fetchedAt: nowMs,
      stale: false,
      windows: [],
      credits: null,
      spend: null,
      meta: {
        dashboardUrl: 'https://claude.ai/settings/usage',
        authFound: true,
      },
      error: {
        code: 'INVALID_JSON',
        message: 'Claude usage endpoint returned a non-JSON response.',
      },
    }
  }

  const parsed = parseClaudeUsage(body, creds.subscriptionType)
  return {
    id: 'claude',
    enabled: true,
    status: parsed.exhausted ? 'rate_limited' : 'ok',
    source: 'api',
    plan: parsed.plan,
    fetchedAt: nowMs,
    stale: false,
    windows: parsed.windows,
    credits: null,
    spend: parsed.spend,
    meta: {
      dashboardUrl: 'https://claude.ai/settings/usage',
      authFound: true,
    },
    error: null,
  }
}
