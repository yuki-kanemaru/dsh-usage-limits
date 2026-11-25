import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const PROVIDER_IDS = ['chatgpt', 'claude', 'gemini', 'mistral']

export const DEFAULT_CONFIG = Object.freeze({
  providers: {
    chatgpt: {
      enabled: true,
    },
    claude: {
      enabled: false,
    },
    gemini: {
      enabled: true,
      showPartnerRow: true,
      budget5hTokens: 0,
      budgetWeeklyTokens: 0,
    },
    mistral: {
      enabled: true,
      apiBaseURL: 'https://api.mistral.ai/v1',
      adminBaseURL: 'https://admin.mistral.ai',
      apiKeyEnv: 'MISTRAL_API_KEY',
      adminCookieEnv: 'MISTRAL_ADMIN_COOKIE',
      budgetMonthlyTokens: 0,
    },
  },
  displayMode: 'remaining',
  refreshIntervalSec: 180,
  collapsed: false,
})

export function resolveDataDir(env = process.env) {
  const override = typeof env.DSH_USAGE_LIMITS_DATA_DIR === 'string' ? env.DSH_USAGE_LIMITS_DATA_DIR.trim() : ''
  if (override) return override
  const dshHome = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  const base = dshHome || join(homedir(), '.dsh')
  return join(base, 'dsh-usage-limits')
}

function safeInt(value, fallback, min, max) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(n)) return fallback
  const rounded = Math.round(n)
  return Math.max(min, Math.min(max, rounded))
}

function safeHttpsUrl(value, fallback) {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return fallback
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return fallback
    return trimmed
  } catch {
    return fallback
  }
}

function safeEnvName(value, fallback) {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) return trimmed
  return fallback
}

export function normalizeConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const rawProviders = input.providers && typeof input.providers === 'object' ? input.providers : {}

  const chatgptIn = rawProviders.chatgpt && typeof rawProviders.chatgpt === 'object' ? rawProviders.chatgpt : {}
  const claudeIn = rawProviders.claude && typeof rawProviders.claude === 'object' ? rawProviders.claude : {}
  const geminiIn = rawProviders.gemini && typeof rawProviders.gemini === 'object' ? rawProviders.gemini : {}
  const mistralIn = rawProviders.mistral && typeof rawProviders.mistral === 'object' ? rawProviders.mistral : {}

  return {
    providers: {
      chatgpt: {
        enabled: typeof chatgptIn.enabled === 'boolean' ? chatgptIn.enabled : DEFAULT_CONFIG.providers.chatgpt.enabled,
      },
      claude: {
        enabled: typeof claudeIn.enabled === 'boolean' ? claudeIn.enabled : DEFAULT_CONFIG.providers.claude.enabled,
      },
      gemini: {
        enabled: typeof geminiIn.enabled === 'boolean' ? geminiIn.enabled : DEFAULT_CONFIG.providers.gemini.enabled,
        showPartnerRow:
          typeof geminiIn.showPartnerRow === 'boolean'
            ? geminiIn.showPartnerRow
            : DEFAULT_CONFIG.providers.gemini.showPartnerRow,
        budget5hTokens: safeInt(geminiIn.budget5hTokens, 0, 0, 1_000_000_000),
        budgetWeeklyTokens: safeInt(geminiIn.budgetWeeklyTokens, 0, 0, 10_000_000_000),
      },
      mistral: {
        enabled: typeof mistralIn.enabled === 'boolean' ? mistralIn.enabled : DEFAULT_CONFIG.providers.mistral.enabled,
        apiBaseURL: safeHttpsUrl(mistralIn.apiBaseURL, DEFAULT_CONFIG.providers.mistral.apiBaseURL),
        adminBaseURL: safeHttpsUrl(mistralIn.adminBaseURL, DEFAULT_CONFIG.providers.mistral.adminBaseURL),
        apiKeyEnv: safeEnvName(mistralIn.apiKeyEnv, DEFAULT_CONFIG.providers.mistral.apiKeyEnv),
        adminCookieEnv: safeEnvName(mistralIn.adminCookieEnv, DEFAULT_CONFIG.providers.mistral.adminCookieEnv),
        budgetMonthlyTokens: safeInt(mistralIn.budgetMonthlyTokens, 0, 0, 10_000_000_000),
      },
    },
    displayMode: input.displayMode === 'used' ? 'used' : 'remaining',
    refreshIntervalSec: safeInt(input.refreshIntervalSec, DEFAULT_CONFIG.refreshIntervalSec, 60, 900),
    collapsed: typeof input.collapsed === 'boolean' ? input.collapsed : DEFAULT_CONFIG.collapsed,
  }
}

export function mergeConfigPatch(current, patch) {
  const base = normalizeConfig(current)
  const p = patch && typeof patch === 'object' ? patch : {}
  const pProv = p.providers && typeof p.providers === 'object' ? p.providers : {}

  return normalizeConfig({
    ...base,
    ...p,
    providers: {
      chatgpt: { ...base.providers.chatgpt, ...(pProv.chatgpt && typeof pProv.chatgpt === 'object' ? pProv.chatgpt : {}) },
      claude: { ...base.providers.claude, ...(pProv.claude && typeof pProv.claude === 'object' ? pProv.claude : {}) },
      gemini: { ...base.providers.gemini, ...(pProv.gemini && typeof pProv.gemini === 'object' ? pProv.gemini : {}) },
      mistral: { ...base.providers.mistral, ...(pProv.mistral && typeof pProv.mistral === 'object' ? pProv.mistral : {}) },
    },
  })
}

export function writeJsonAtomic(filePath, data) {
  const dir = dirname(filePath)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  const payload = JSON.stringify(data, null, 2) + '\n'
  writeFileSync(tmpPath, payload, { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(tmpPath, 0o600)
  } catch {
    // Windows does not enforce POSIX chmod bits.
  }
  renameSync(tmpPath, filePath)
}

export function createConfigStore(options = {}) {
  const dataDir = options.dataDir || resolveDataDir()
  const configFile = join(dataDir, 'config.json')
  let state = loadFromDisk()

  function loadFromDisk() {
    try {
      const raw = readFileSync(configFile, 'utf8')
      return normalizeConfig(JSON.parse(raw))
    } catch {
      return normalizeConfig(DEFAULT_CONFIG)
    }
  }

  function get() {
    return state
  }

  function update(patch) {
    const next = mergeConfigPatch(state, patch)
    writeJsonAtomic(configFile, next)
    state = next
    return state
  }

  return {
    dataDir,
    configFile,
    get,
    update,
    reload() {
      state = loadFromDisk()
      return state
    },
  }
}
