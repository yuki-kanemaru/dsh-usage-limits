import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const DEFAULT_TIMEOUT_MS = 8000

export function decodeJwtPayload(token) {
  if (typeof token !== 'string' || !token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

export function readCodexCredentials(authFile = join(homedir(), '.codex', 'auth.json')) {
  let raw
  try {
    raw = readFileSync(authFile, 'utf8')
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: false, reason: 'missing' }
    return { ok: false, reason: 'unreadable' }
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'corrupt' }
  }

  const tokens = parsed && typeof parsed.tokens === 'object' && parsed.tokens !== null ? parsed.tokens : {}
  const accessToken = typeof tokens.access_token === 'string' && tokens.access_token.trim() !== ''
    ? tokens.access_token.trim()
    : null

  if (!accessToken) {
    return { ok: false, reason: 'no_access_token' }
  }

  const jwt = decodeJwtPayload(accessToken)
  const authClaim = jwt && typeof jwt['https://api.openai.com/auth'] === 'object' ? jwt['https://api.openai.com/auth'] : {}
  const accountId =
    (typeof tokens.account_id === 'string' && tokens.account_id.trim()) ||
    (typeof authClaim.chatgpt_account_id === 'string' && authClaim.chatgpt_account_id.trim()) ||
    null
  const planFromJwt = typeof authClaim.chatgpt_plan_type === 'string' ? authClaim.chatgpt_plan_type : null
  const expSec = jwt && typeof jwt.exp === 'number' && Number.isFinite(jwt.exp) ? jwt.exp : null

  return {
    ok: true,
    accessToken,
    accountId,
    planFromJwt,
    expSec,
  }
}

function clampPct(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10))
}

function windowResetIso(win, nowMs) {
  if (!win || typeof win !== 'object') return null
  if (typeof win.reset_at === 'number' && Number.isFinite(win.reset_at) && win.reset_at > 0) {
    const ms = win.reset_at > 1e12 ? win.reset_at : win.reset_at * 1000
    return new Date(ms).toISOString()
  }
  if (typeof win.reset_at === 'string' && win.reset_at.trim() !== '') {
    return win.reset_at.trim()
  }
  if (typeof win.reset_after_seconds === 'number' && Number.isFinite(win.reset_after_seconds) && win.reset_after_seconds >= 0) {
    return new Date(nowMs + win.reset_after_seconds * 1000).toISOString()
  }
  return null
}

function labelForWindowSeconds(seconds, fallback) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return fallback
  const hours = Math.round(seconds / 3600)
  if (hours <= 6) return `${hours}h`
  const days = Math.round(seconds / 86400)
  if (days === 7) return 'weekly'
  if (days >= 28 && days <= 31) return 'monthly'
  return `${days}d`
}

export function parseChatGptUsage(payload, nowMs = Date.now(), fallbackPlan = null) {
  const data = payload && typeof payload === 'object' ? payload : {}
  const plan = typeof data.plan_type === 'string' && data.plan_type ? data.plan_type : fallbackPlan
  const windows = []

  const pushWindow = (win, id, defaultLabel, group = 'primary') => {
    if (!win || typeof win !== 'object') return
    const used = clampPct(win.used_percent)
    if (used === null) return
    const remaining = clampPct(100 - used)
    windows.push({
      id,
      label: labelForWindowSeconds(win.limit_window_seconds, defaultLabel),
      group,
      usedPercent: used,
      remainingPercent: remaining,
      resetsAt: windowResetIso(win, nowMs),
    })
  }

  const rateLimit = data.rate_limit && typeof data.rate_limit === 'object' ? data.rate_limit : null
  if (rateLimit) {
    pushWindow(rateLimit.primary_window, 'primary', '5h', 'primary')
    pushWindow(rateLimit.secondary_window, 'secondary', 'weekly', 'primary')
  }

  const codeReview = data.code_review_rate_limit && typeof data.code_review_rate_limit === 'object' ? data.code_review_rate_limit : null
  if (codeReview?.primary_window) {
    pushWindow(codeReview.primary_window, 'code_review', 'Code review', 'partner')
  }

  if (Array.isArray(data.additional_rate_limits)) {
    for (let i = 0; i < data.additional_rate_limits.length; i += 1) {
      const item = data.additional_rate_limits[i]
      if (!item || typeof item !== 'object') continue
      const name = typeof item.limit_name === 'string' && item.limit_name ? item.limit_name : `extra-${i + 1}`
      const rl = item.rate_limit && typeof item.rate_limit === 'object' ? item.rate_limit : null
      if (rl?.primary_window) {
        pushWindow(rl.primary_window, `extra-${i}-primary`, `${name} (5h)`, 'partner')
      }
      if (rl?.secondary_window) {
        pushWindow(rl.secondary_window, `extra-${i}-secondary`, `${name} (weekly)`, 'partner')
      }
    }
  }

  let credits = null
  if (data.credits && typeof data.credits === 'object') {
    const bal = typeof data.credits.balance === 'number'
      ? data.credits.balance
      : typeof data.credits.balance === 'string' && data.credits.balance.trim() !== '' && Number.isFinite(Number(data.credits.balance))
        ? Number(data.credits.balance)
        : null
    if (bal !== null) {
      credits = { balance: bal, currency: 'USD' }
    }
  }

  return {
    plan: plan || null,
    windows,
    credits,
    limitReached: Boolean(rateLimit?.limit_reached),
  }
}

export async function fetchChatGptQuota(options = {}) {
  const nowMs = typeof options.now === 'number' ? options.now : Date.now()
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : fetch
  const authFile = options.authFile || join(homedir(), '.codex', 'auth.json')
  const usageUrl = options.usageUrl || DEFAULT_USAGE_URL
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS

  const creds = readCodexCredentials(authFile)
  if (!creds.ok) {
    return {
      id: 'chatgpt',
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
        dashboardUrl: 'https://chatgpt.com/#settings/Usage',
        authFileFound: creds.reason !== 'missing',
      },
      error: {
        code: creds.reason === 'missing' ? 'NO_CODEX_AUTH' : 'INVALID_CODEX_AUTH',
        message: creds.reason === 'missing'
          ? 'Codex login (~/.codex/auth.json) was not found. Run `codex login` to enable numeric windows.'
          : 'Could not read a valid token from ~/.codex/auth.json.',
      },
    }
  }

  const headers = {
    Authorization: `Bearer ${creds.accessToken}`,
    Accept: 'application/json',
    'User-Agent': 'codex-cli/1.0',
  }
  if (creds.accountId) {
    headers['ChatGPT-Account-Id'] = creds.accountId
  }

  let response
  try {
    response = await fetchImpl(usageUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    return {
      id: 'chatgpt',
      enabled: true,
      status: 'error',
      source: 'api',
      plan: creds.planFromJwt,
      fetchedAt: nowMs,
      stale: false,
      windows: [],
      credits: null,
      spend: null,
      meta: {
        dashboardUrl: 'https://chatgpt.com/#settings/Usage',
        authFileFound: true,
      },
      error: {
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : 'Network error while querying ChatGPT usage.',
      },
    }
  }

  if (response.status === 401 || response.status === 403) {
    return {
      id: 'chatgpt',
      enabled: true,
      status: 'auth_expired',
      source: 'api',
      plan: creds.planFromJwt,
      fetchedAt: nowMs,
      stale: false,
      windows: [],
      credits: null,
      spend: null,
      meta: {
        dashboardUrl: 'https://chatgpt.com/#settings/Usage',
        authFileFound: true,
      },
      error: {
        code: 'AUTH_EXPIRED',
        message: `ChatGPT usage endpoint returned HTTP ${response.status}. Run \`codex login\` to refresh credentials.`,
      },
    }
  }

  if (response.status === 429) {
    return {
      id: 'chatgpt',
      enabled: true,
      status: 'rate_limited',
      source: 'api',
      plan: creds.planFromJwt,
      fetchedAt: nowMs,
      stale: false,
      windows: [],
      credits: null,
      spend: null,
      meta: {
        dashboardUrl: 'https://chatgpt.com/#settings/Usage',
        authFileFound: true,
      },
      error: {
        code: 'RATE_LIMITED',
        message: 'ChatGPT usage endpoint rate-limited the request (HTTP 429).',
      },
    }
  }

  if (!response.ok) {
    return {
      id: 'chatgpt',
      enabled: true,
      status: 'error',
      source: 'api',
      plan: creds.planFromJwt,
      fetchedAt: nowMs,
      stale: false,
      windows: [],
      credits: null,
      spend: null,
      meta: {
        dashboardUrl: 'https://chatgpt.com/#settings/Usage',
        authFileFound: true,
      },
      error: {
        code: 'HTTP_ERROR',
        message: `ChatGPT usage endpoint returned HTTP ${response.status}.`,
      },
    }
  }

  let body
  try {
    body = await response.json()
  } catch {
    return {
      id: 'chatgpt',
      enabled: true,
      status: 'error',
      source: 'api',
      plan: creds.planFromJwt,
      fetchedAt: nowMs,
      stale: false,
      windows: [],
      credits: null,
      spend: null,
      meta: {
        dashboardUrl: 'https://chatgpt.com/#settings/Usage',
        authFileFound: true,
      },
      error: {
        code: 'INVALID_JSON',
        message: 'ChatGPT usage endpoint returned a non-JSON response.',
      },
    }
  }

  const parsed = parseChatGptUsage(body, nowMs, creds.planFromJwt)
  return {
    id: 'chatgpt',
    enabled: true,
    status: parsed.limitReached ? 'rate_limited' : 'ok',
    source: 'api',
    plan: parsed.plan,
    fetchedAt: nowMs,
    stale: false,
    windows: parsed.windows,
    credits: parsed.credits,
    spend: null,
    meta: {
      dashboardUrl: 'https://chatgpt.com/#settings/Usage',
      authFileFound: true,
    },
    error: null,
  }
}
