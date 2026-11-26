const DEFAULT_TIMEOUT_MS = 8000

function num(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

function firstString(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  }
  return undefined
}

function clampPct(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10))
}

export function csrfFromCookie(cookie) {
  const match = /(?:^|;\s*)csrftoken=([^;]+)/.exec(String(cookie || ''))
  return match?.[1]
}

export function collectAllowances(value) {
  const found = []
  const seen = new Set()
  const visit = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, [...path, String(index)]))
      return
    }
    if (node === null || typeof node !== 'object') return
    const used = num(node.used ?? node.usage ?? node.consumed ?? node.used_amount ?? node.usedAmount)
    const total = num(
      node.total ??
        node.limit ??
        node.included ??
        node.quota ??
        node.allowance ??
        node.total_amount ??
        node.totalAmount ??
        node.max,
    )
    const percent = num(node.percent ?? node.percentage ?? node.used_percent ?? node.usedPercent ?? node.usage_percentage ?? node.usagePercentage)
    if (percent !== undefined || (used !== undefined && total !== undefined && total > 0)) {
      // Skip $0 / unallocated allowance buckets that would falsely show 0% remaining.
      if (total !== undefined && total <= 0) return
      const label = firstString(node.name, node.label, node.title, node.plan, node.kind, node.type) ?? 'Allowance'
      const computed = percent ?? (total !== undefined && total > 0 ? (used / total) * 100 : undefined)
      const usedPct = clampPct(computed)
      const signature = `${label}|${used}|${total}|${Math.round(usedPct ?? -1)}`
      if (!seen.has(signature) && usedPct !== null) {
        seen.add(signature)
        found.push({
          id: path.join('-') || 'allowance',
          label,
          group: 'primary',
          usedPercent: usedPct,
          remainingPercent: clampPct(100 - usedPct),
          used: used ?? null,
          total: total ?? null,
          unit: firstString(node.unit, node.currency, node.currency_code) ?? 'USD',
          resetsAt:
            firstString(
              node.reset_at,
              node.resetAt,
              node.renewal_date,
              node.renewalDate,
              node.period_end,
              node.periodEnd,
              node.ends_at,
              node.endsAt,
              node.expires_at,
            ) ?? null,
        })
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (child !== null && typeof child === 'object') visit(child, [...path, key])
    }
  }
  visit(value, [])
  return found
}

export function collectCredits(value) {
  let result = null
  const visit = (node) => {
    if (result !== null || node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    const balance = num(node.balance ?? node.credits ?? node.available ?? node.remaining_credits ?? node.remainingCredits)
    if (balance !== undefined) {
      result = {
        balance,
        currency: firstString(node.currency, node.currency_code, node.unit) ?? 'USD',
      }
      return
    }
    for (const child of Object.values(node)) visit(child)
  }
  visit(value)
  return result
}

export function collectSpend(value) {
  let result = null
  const visit = (node) => {
    if (result !== null || node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    const amount = num(node.total_spent ?? node.totalSpent ?? node.total_amount ?? node.totalAmount ?? node.amount_paid ?? node.amountPaid)
    if (amount !== undefined) {
      result = {
        amount,
        currency: firstString(node.currency, node.currency_code, node.unit) ?? 'USD',
      }
      return
    }
    for (const child of Object.values(node)) visit(child)
  }
  visit(value)
  return result
}

export function parseApiBilling(subscription, budget) {
  const plan = firstString(subscription?.plan_name, subscription?.plan, subscription?.planName) ?? null
  const windows = []
  const skippedZeroBudgets = []

  const pushEntry = (entry, id, label) => {
    if (!entry || typeof entry !== 'object') return
    const usedPct = clampPct(num(entry.usage_percentage ?? entry.usagePercentage))
    const total = num(entry.initial_budget ?? entry.initialBudget ?? entry.budget)
    if (usedPct === null && total === undefined) return
    const unit = firstString(entry.currency) ?? 'USD'
    const used = usedPct !== null && total !== undefined ? Math.round(((usedPct / 100) * total) * 100) / 100 : null
    const win = {
      id,
      label,
      group: 'primary',
      usedPercent: usedPct,
      remainingPercent: usedPct === null ? null : clampPct(100 - usedPct),
      used,
      total: total ?? null,
      unit,
      resetsAt: firstString(entry.reset_at, entry.resetAt) ?? null,
    }
    // Many Mistral Vibe plans return `api_budget` with initial_budget=0 and
    // usage_percentage=100 (or 0) when no separate API budget is allocated.
    // Do not let an unallocated $0 bucket mask an active Vibe budget as red 0%.
    if (total !== undefined && total <= 0) {
      skippedZeroBudgets.push(win)
      return
    }
    windows.push(win)
  }

  pushEntry(budget?.vibe_budget, 'vibe', 'Vibe budget')
  pushEntry(budget?.api_budget, 'api', 'API budget')
  if (windows.length === 0 && skippedZeroBudgets.length === 0) {
    pushEntry(budget, 'budget', 'Monthly budget')
  }
  if (windows.length === 0 && skippedZeroBudgets.length > 0) {
    windows.push(...skippedZeroBudgets)
  }

  return { plan, windows }
}

async function resolveSecret(credentials, refName, env = process.env) {
  if (!refName) return null
  if (credentials && typeof credentials.resolve === 'function') {
    try {
      const hit = await credentials.resolve(refName)
      if (hit && typeof hit.value === 'string' && hit.value.trim() !== '') {
        return hit.value.trim()
      }
    } catch {
      // Fall back to environment variable.
    }
  }
  const fromEnv = typeof env[refName] === 'string' ? env[refName].trim() : ''
  return fromEnv || null
}

async function apiGet(fetchImpl, url, apiKey, signal) {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    signal,
  })
  if (!response.ok) {
    const err = new Error(`Mistral API returned HTTP ${response.status} for ${new URL(url).pathname}`)
    err.code = response.status === 401 || response.status === 403 ? 'AUTH_ERROR' : 'BILLING_HTTP'
    err.status = response.status
    throw err
  }
  return response.json()
}

async function adminGet(fetchImpl, url, cookie, signal) {
  const headers = {
    Accept: 'application/json',
    Cookie: cookie,
  }
  const csrf = csrfFromCookie(cookie)
  if (csrf) headers['x-csrftoken'] = csrf

  const response = await fetchImpl(url, {
    method: 'GET',
    headers,
    redirect: 'manual',
    signal,
  })

  if (response.status === 0 || response.status === 301 || response.status === 302 || response.status === 303 || response.status === 307) {
    const location = response.headers?.get?.('location') || ''
    if (location.includes('auth.mistral.ai') || location.includes('/login')) {
      const err = new Error('Mistral admin session expired. Paste a fresh Cookie header in plugin settings.')
      err.code = 'SESSION_EXPIRED'
      throw err
    }
  }

  if (response.status === 401 || response.status === 403) {
    const err = new Error(`Mistral admin returned HTTP ${response.status}. Paste a fresh Cookie header.`)
    err.code = 'SESSION_EXPIRED'
    throw err
  }

  if (!response.ok) {
    const err = new Error(`admin.mistral.ai returned HTTP ${response.status} for ${new URL(url).pathname}`)
    err.code = 'ADMIN_HTTP'
    throw err
  }

  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    const err = new Error(`admin.mistral.ai returned non-JSON for ${new URL(url).pathname}`)
    err.code = 'ADMIN_SHAPE'
    throw err
  }
}

function dedupeWindows(windows) {
  const seen = new Set()
  const out = []
  for (const w of windows) {
    const sig = `${w.label}|${w.used}|${w.total}|${w.usedPercent}`
    if (seen.has(sig)) continue
    seen.add(sig)
    out.push(w)
  }
  return out
}

export async function fetchMistralQuota(options = {}) {
  const nowMs = typeof options.now === 'number' ? options.now : Date.now()
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : fetch
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS
  const providerConfig = options.providerConfig || {}
  const trackerSummary = options.trackerSummary || null

  const apiBaseURL = String(providerConfig.apiBaseURL || 'https://api.mistral.ai/v1').replace(/\/+$/, '')
  const adminBaseURL = String(providerConfig.adminBaseURL || 'https://admin.mistral.ai').replace(/\/+$/, '')
  const apiKeyEnv = providerConfig.apiKeyEnv || 'MISTRAL_API_KEY'
  const adminCookieEnv = providerConfig.adminCookieEnv || 'MISTRAL_ADMIN_COOKIE'

  const apiKey = await resolveSecret(options.credentials, apiKeyEnv, options.env)
  const adminCookie = await resolveSecret(options.credentials, adminCookieEnv, options.env)

  const baseMeta = {
    dashboardUrl: `${adminBaseURL}/subscription`,
    usageUrl: `${adminBaseURL}/organization/usage`,
    apiKeyConfigured: Boolean(apiKey),
    cookieConfigured: Boolean(adminCookie),
    apiKeyEnv,
    adminCookieEnv,
  }

  let apiResult = null
  let apiError = null
  if (apiKey) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('Mistral API request timed out')), timeoutMs)
    try {
      const [subRes, budgetRes] = await Promise.allSettled([
        apiGet(fetchImpl, `${apiBaseURL}/billing/subscription`, apiKey, controller.signal),
        apiGet(fetchImpl, `${apiBaseURL}/billing/budget`, apiKey, controller.signal),
      ])
      const sub = subRes.status === 'fulfilled' ? subRes.value : null
      const budget = budgetRes.status === 'fulfilled' ? budgetRes.value : null
      if (sub || budget) {
        const parsed = parseApiBilling(sub, budget)
        if (parsed.windows.length > 0 || parsed.plan) {
          apiResult = parsed
        }
      }
      if (!apiResult) {
        const reasons = [subRes, budgetRes]
          .filter((r) => r.status === 'rejected')
          .map((r) => r.reason)
        apiError = reasons[0] || null
      }
    } finally {
      clearTimeout(timer)
    }
  }

  let adminResult = null
  let adminError = null
  if (adminCookie) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('Mistral admin request timed out')), timeoutMs)
    const dt = new Date(nowMs)
    const usageUrl = `${adminBaseURL}/api/billing/v2/usage?month=${dt.getUTCMonth() + 1}&year=${dt.getUTCFullYear()}`

    try {
      const [subRes, usageRes, creditsRes] = await Promise.allSettled([
        adminGet(fetchImpl, `${adminBaseURL}/subscription`, adminCookie, controller.signal),
        adminGet(fetchImpl, usageUrl, adminCookie, controller.signal),
        adminGet(fetchImpl, `${adminBaseURL}/api/billing/credits`, adminCookie, controller.signal),
      ])

      const subData = subRes.status === 'fulfilled' ? subRes.value : undefined
      const usageData = usageRes.status === 'fulfilled' ? usageRes.value : undefined
      const creditsData = creditsRes.status === 'fulfilled' ? creditsRes.value : undefined

      const reasons = [subRes, usageRes, creditsRes]
        .filter((r) => r.status === 'rejected')
        .map((r) => r.reason)

      if (subData === undefined && usageData === undefined && creditsData === undefined) {
        adminError = reasons.find((r) => r?.code === 'SESSION_EXPIRED') || reasons[0] || new Error('Mistral admin usage unavailable.')
      } else {
        const windows = []
        if (subData !== undefined) windows.push(...collectAllowances(subData))
        if (usageData !== undefined) windows.push(...collectAllowances(usageData))
        adminResult = {
          plan: firstString(subData?.plan, subData?.plan_name, subData?.subscription?.plan) ?? null,
          windows: dedupeWindows(windows),
          credits: creditsData !== undefined ? collectCredits(creditsData) : null,
          spend: usageData !== undefined ? collectSpend(usageData) : null,
        }
      }
    } finally {
      clearTimeout(timer)
    }
  }

  if (apiResult || adminResult) {
    const windows = dedupeWindows([
      ...(apiResult?.windows || []),
      ...(adminResult?.windows || []),
    ])
    const plan = apiResult?.plan || adminResult?.plan || null
    const activeBudgets = windows.filter((w) => w.total === null || w.total === undefined || w.total > 0)
    const checkPool = activeBudgets.length > 0 ? activeBudgets : windows
    const exhausted = checkPool.length > 0 && checkPool.every((w) => w.remainingPercent !== null && w.remainingPercent <= 0)
    return {
      id: 'mistral',
      enabled: true,
      status: exhausted ? 'rate_limited' : 'ok',
      source: apiResult ? (adminResult ? 'api+cookie' : 'api') : 'admin-cookie',
      plan,
      fetchedAt: nowMs,
      stale: false,
      windows,
      credits: adminResult?.credits || null,
      spend: adminResult?.spend || null,
      tracker: trackerSummary,
      meta: baseMeta,
      error: null,
    }
  }

  const windows = []
  const monthlyBudget = Number(providerConfig.budgetMonthlyTokens) || 0
  if (monthlyBudget > 0 && trackerSummary) {
    const used = trackerSummary.thisMonth?.tokens || 0
    const usedPct = clampPct((used / monthlyBudget) * 100)
    windows.push({
      id: 'budget-monthly',
      label: 'monthly (est.)',
      group: 'budget',
      usedPercent: usedPct,
      remainingPercent: usedPct === null ? null : clampPct(100 - usedPct),
      used,
      total: monthlyBudget,
      unit: 'tokens',
      resetsAt: null,
    })
  }

  if (!apiKey && !adminCookie) {
    return {
      id: 'mistral',
      enabled: true,
      status: 'unconfigured',
      source: trackerSummary ? 'tracker' : 'none',
      plan: null,
      fetchedAt: nowMs,
      stale: false,
      windows,
      credits: null,
      spend: null,
      tracker: trackerSummary,
      meta: baseMeta,
      error: {
        code: 'NO_MISTRAL_CREDENTIAL',
        message: 'Configure MISTRAL_API_KEY in DSH Models settings or paste an admin.mistral.ai Cookie in plugin settings.',
      },
    }
  }

  if (adminError?.code === 'SESSION_EXPIRED') {
    return {
      id: 'mistral',
      enabled: true,
      status: 'auth_expired',
      source: 'admin-cookie',
      plan: null,
      fetchedAt: nowMs,
      stale: false,
      windows,
      credits: null,
      spend: null,
      tracker: trackerSummary,
      meta: baseMeta,
      error: {
        code: 'SESSION_EXPIRED',
        message: adminError.message,
      },
    }
  }

  return {
    id: 'mistral',
    enabled: true,
    status: trackerSummary?.recentQuotaError ? 'rate_limited' : 'ok',
    source: 'tracker',
    plan: 'Mistral Vibe',
    fetchedAt: nowMs,
    stale: false,
    windows,
    credits: null,
    spend: null,
    tracker: trackerSummary,
    meta: baseMeta,
    error: apiError
      ? {
          code: 'BILLING_FALLBACK',
          message: `API billing unavailable (${apiError.message}). Paste an admin.mistral.ai Cookie in plugin settings to read Vibe / API budgets.`,
        }
      : adminError
        ? {
            code: 'ADMIN_ERROR',
            message: adminError.message || 'Could not read Mistral admin usage.',
          }
        : null,
  }
}
