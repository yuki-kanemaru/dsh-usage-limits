import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createConfigStore, mergeConfigPatch } from '../lib/config-store.js'
import { createUsageTracker } from '../lib/usage-tracker.js'
import { buildHookCommand, inspectAgyHook, installAgyHook, uninstallAgyHook } from '../lib/agy-hook-setup.js'
import { fetchChatGptQuota, parseChatGptUsage } from '../lib/providers/chatgpt.js'
import { fetchClaudeQuota, parseClaudeUsage } from '../lib/providers/claude.js'
import { fetchGeminiQuota, parseAgyQuotaCache } from '../lib/providers/gemini.js'
import { fetchMistralQuota, parseApiBilling } from '../lib/providers/mistral.js'
import {
  calculateEffectiveYenPerKwh,
  createPcMonitor,
  estimateSystemWatts,
  parseNvidiaSmiCsv,
} from '../lib/pc-monitor.js'
import { createUsageLimitsService } from '../index.js'

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'dsh-usage-limits-test-'))
}

test('config-store defaults Claude to disabled, Gemini partner row to enabled, and persists toggles atomically', () => {
  const dir = makeTmpDir()
  try {
    const store = createConfigStore({ dataDir: dir })
    const initial = store.get()
    assert.equal(initial.providers.chatgpt.enabled, true)
    assert.equal(initial.providers.claude.enabled, false)
    assert.equal(initial.providers.gemini.enabled, true)
    assert.equal(initial.providers.gemini.showPartnerRow, true)
    assert.equal(initial.providers.mistral.enabled, true)
    assert.equal(initial.displayMode, 'remaining')
    assert.equal(initial.collapsed, false)

    const updated = store.update({
      providers: { claude: { enabled: true }, chatgpt: { enabled: false }, gemini: { showPartnerRow: false } },
      displayMode: 'used',
      refreshIntervalSec: 30,
      collapsed: true,
    })
    assert.equal(updated.providers.claude.enabled, true)
    assert.equal(updated.providers.chatgpt.enabled, false)
    assert.equal(updated.providers.gemini.showPartnerRow, false)
    assert.equal(updated.displayMode, 'used')
    assert.equal(updated.refreshIntervalSec, 60)
    assert.equal(updated.collapsed, true)

    const reloaded = createConfigStore({ dataDir: dir }).get()
    assert.equal(reloaded.providers.claude.enabled, true)
    assert.equal(reloaded.providers.chatgpt.enabled, false)
    assert.equal(reloaded.providers.gemini.showPartnerRow, false)
    assert.equal(reloaded.collapsed, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ChatGPT parser extracts 5h and weekly windows without leaking tokens', async () => {
  const dir = makeTmpDir()
  const secretToken = 'eyJhbGciOiJub25lIn0.eyJleHAiOjIwMDAwMDAwMDAsImh0dHBzOi8vYXBpLm9wZW5haS5jb20vYXV0aCI6eyJjaGF0Z3B0X3BsYW5fdHlwZSI6InBsdXMiLCJjaGF0Z3B0X2FjY291bnRfaWQiOiJhY2N0XzEyMyJ9fQ.sig'
  try {
    const authFile = join(dir, 'auth.json')
    writeFileSync(authFile, JSON.stringify({ tokens: { access_token: secretToken, account_id: 'acct_123' } }), 'utf8')

    const result = await fetchChatGptQuota({
      authFile,
      now: 1700000000000,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            plan_type: 'plus',
            rate_limit: {
              limit_reached: false,
              primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_after_seconds: 3600 },
              secondary_window: { used_percent: 60, limit_window_seconds: 604800, reset_after_seconds: 86400 },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    })

    assert.equal(result.status, 'ok')
    assert.equal(result.plan, 'plus')
    assert.equal(result.windows.length, 2)
    assert.equal(result.windows[0].remainingPercent, 75)
    assert.equal(result.windows[1].remainingPercent, 40)
    assert.equal(JSON.stringify(result).includes(secretToken), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Claude adapter handles missing auth cleanly and parses five_hour / seven_day windows', async () => {
  const dir = makeTmpDir()
  try {
    const unconfigured = await fetchClaudeQuota({
      env: {},
      credentialsFile: join(dir, 'missing.json'),
    })
    assert.equal(unconfigured.status, 'unconfigured')

    const parsed = parseClaudeUsage({
      five_hour: { utilization: 32.5, resets_at: '2026-11-25T15:00:00Z' },
      seven_day: { utilization: 80, resets_at: '2026-12-01T00:00:00Z' },
    })
    assert.equal(parsed.windows.length, 2)
    assert.equal(parsed.windows[0].remainingPercent, 67.5)
    assert.equal(parsed.windows[1].remainingPercent, 20)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Gemini adapter separates Gemini primary buckets and 3p-* partner buckets', async () => {
  const dir = makeTmpDir()
  try {
    writeFileSync(
      join(dir, 'agy-quota-cache.json'),
      JSON.stringify({
        version: 1,
        updatedAt: 1700000000000,
        planTier: 'Pro',
        quota: {
          '3p-5h': { remaining_fraction: 1, reset_in_seconds: 17996 },
          '3p-weekly': { remaining_fraction: 1, reset_time: '2026-12-02T04:35:29Z' },
          'gemini-5h': { remaining_fraction: 0.4227, reset_in_seconds: 7502 },
          'gemini-weekly': { remaining_fraction: 0.8566, reset_time: '2026-12-02T01:40:35Z' },
        },
      }),
      'utf8',
    )

    const result = await fetchGeminiQuota({
      dataDir: dir,
      settingsPath: join(dir, 'settings.json'),
      now: 1700000000000,
    })

    assert.equal(result.status, 'ok')
    assert.equal(result.source, 'statusline')
    assert.equal(result.plan, 'Google AI Pro')
    const primary = result.windows.filter((w) => w.group === 'primary')
    const partner = result.windows.filter((w) => w.group === 'partner')
    assert.equal(primary.length, 2)
    assert.equal(primary[0].id, 'gemini-5h')
    assert.equal(primary[1].id, 'gemini-weekly')
    assert.equal(partner.length, 2)
    assert.equal(partner[0].id, '3p-5h')
    assert.equal(partner[1].id, '3p-weekly')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Mistral adapter skips unallocated $0 api_budget so active Vibe budget displays cleanly', async () => {
  const secretKey = 'mistral-secret-key-test'
  const secretCookie = 'ory_session_abc=supersecret; csrftoken=csrf123'

  const apiOk = await fetchMistralQuota({
    env: { MISTRAL_API_KEY: secretKey },
    fetchImpl: async (url) => {
      if (url.endsWith('/billing/subscription')) {
        return new Response(JSON.stringify({ plan_name: 'Vibe Pro' }), { status: 200 })
      }
      if (url.endsWith('/billing/budget')) {
        return new Response(
          JSON.stringify({
            vibe_budget: { usage_percentage: 29, initial_budget: 20, currency: 'USD', reset_at: '2026-12-01T00:00:00Z' },
            api_budget: { usage_percentage: 100, initial_budget: 0, currency: 'USD' },
          }),
          { status: 200 },
        )
      }
      return new Response('{}', { status: 404 })
    },
  })

  assert.equal(apiOk.status, 'ok')
  assert.equal(apiOk.source, 'api')
  assert.equal(apiOk.windows.length, 1)
  assert.equal(apiOk.windows[0].id, 'vibe')
  assert.equal(apiOk.windows[0].remainingPercent, 71)
  assert.equal(JSON.stringify(apiOk).includes(secretKey), false)

  const expired = await fetchMistralQuota({
    env: { MISTRAL_ADMIN_COOKIE: secretCookie },
    fetchImpl: async () =>
      new Response('', {
        status: 302,
        headers: { location: 'https://auth.mistral.ai/login' },
      }),
  })
  assert.equal(expired.status, 'auth_expired')
  assert.equal(JSON.stringify(expired).includes(secretCookie), false)

  const partialOk = await fetchMistralQuota({
    env: { MISTRAL_API_KEY: secretKey },
    fetchImpl: async (url) => {
      if (url.endsWith('/billing/subscription')) {
        return new Response('rate limited', { status: 429 })
      }
      if (url.endsWith('/billing/budget')) {
        return new Response(
          JSON.stringify({
            vibe_budget: { usage_percentage: 43, initial_budget: 20, currency: 'USD' },
          }),
          { status: 200 },
        )
      }
      return new Response('{}', { status: 404 })
    },
  })
  assert.equal(partialOk.status, 'ok')
  assert.equal(partialOk.source, 'api')
  assert.equal(partialOk.windows.length, 1)
  assert.equal(partialOk.windows[0].remainingPercent, 57)
})

test('agy-hook-setup omits quotes on space-free paths and repairs legacy Windows quoted commands', () => {
  const dir = makeTmpDir()
  try {
    const cmd = buildHookCommand('C:\\work\\agy-statusline-hook.mjs', 'C:\\node\\node.exe', { platform: 'win32' })
    assert.equal(cmd, 'C:\\node\\node.exe C:\\work\\agy-statusline-hook.mjs')
    assert.equal(cmd.includes('"'), false)

    const settingsPath = join(dir, 'settings.json')
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          trustedWorkspaces: ['C:\\work'],
          statusLine: {
            type: 'command',
            command: 'C:\\node\\node.exe "C:\\work\\agy-statusline-hook.mjs"',
            enabled: true,
            stack_with_default: true,
          },
        },
        null,
        2,
      ),
      'utf8',
    )

    const before = inspectAgyHook({ settingsPath, platform: 'win32', dataDir: dir })
    assert.equal(before.needsRepair, true)
    assert.equal(before.installed, false)

    const installRes = installAgyHook({
      settingsPath,
      platform: 'win32',
      dataDir: dir,
      nodeExec: 'C:\\node\\node.exe',
      scriptPath: 'C:\\work\\agy-statusline-hook.mjs',
    })
    assert.equal(installRes.ok, true)
    assert.equal(installRes.command.includes('"'), false)
    assert.equal(inspectAgyHook({ settingsPath, platform: 'win32', dataDir: dir }).installed, true)

    const saved = JSON.parse(readFileSync(settingsPath, 'utf8'))
    assert.deepEqual(saved.trustedWorkspaces, ['C:\\work'])
    assert.equal(saved.statusLine.stack_with_default, true)

    const uninstallRes = uninstallAgyHook({ settingsPath, dataDir: dir })
    assert.equal(uninstallRes.ok, true)
    const after = JSON.parse(readFileSync(settingsPath, 'utf8'))
    assert.deepEqual(after.trustedWorkspaces, ['C:\\work'])
    assert.equal('statusLine' in after, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('usage-limits service preserves stale snapshot and parses helpers', async () => {
  const dir = makeTmpDir()
  try {
    const svc = createUsageLimitsService({ dataDir: dir })
    assert.equal(svc.getSnapshot().providers.claude.enabled, false)
    const parsed = parseApiBilling({ plan_name: 'Pro' }, { vibe_budget: { usage_percentage: 30, initial_budget: 20 } })
    assert.equal(parsed.windows[0].remainingPercent, 70)
    const tracker = createUsageTracker({ dataDir: dir })
    tracker.recordUsage({ provider: 'agy-acp', model: 'gemini-4-neon', inputTokens: 1000, outputTokens: 500 })
    assert.equal(tracker.summarize('gemini').last5h.tokens, 1500)
    assert.equal(mergeConfigPatch({}, { providers: { claude: { enabled: true } } }).providers.claude.enabled, true)
    assert.equal(parseChatGptUsage({ rate_limit: { primary_window: { used_percent: 10 } } }).windows[0].remainingPercent, 90)
    assert.equal(parseAgyQuotaCache({ quota: { 'gemini-weekly': { remaining_fraction: 0.5 } } }).windows[0].remainingPercent, 50)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('usage-limits service flags credential retry when Mistral refreshes before credentials mount', async () => {
  const dir = makeTmpDir()
  const prevApiKey = process.env.MISTRAL_API_KEY
  const prevCookie = process.env.MISTRAL_ADMIN_COOKIE
  delete process.env.MISTRAL_API_KEY
  delete process.env.MISTRAL_ADMIN_COOKIE
  try {
    let creds = undefined
    const svc = createUsageLimitsService({
      dataDir: dir,
      getCredentials: () => creds,
      fetchImpl: async (url) => {
        if (url.endsWith('/billing/subscription')) {
          return new Response(JSON.stringify({ plan_name: 'Vibe Pro' }), { status: 200 })
        }
        if (url.endsWith('/billing/budget')) {
          return new Response(
            JSON.stringify({
              vibe_budget: { usage_percentage: 40, initial_budget: 20, currency: 'USD' },
            }),
            { status: 200 },
          )
        }
        return new Response('{}', { status: 404 })
      },
    })

    const before = await svc.refreshOne('mistral')
    assert.equal(before.status, 'unconfigured')
    assert.equal(svc.needsCredentialRetry('mistral'), false)

    creds = {
      resolve: async (ref) => (ref === 'MISTRAL_API_KEY' ? { value: 'test-mistral-key', source: 'store' } : undefined),
    }
    assert.equal(svc.needsCredentialRetry('mistral'), true)

    const after = await svc.refreshOne('mistral')
    assert.equal(after.status, 'ok')
    assert.equal(after.source, 'api')
    assert.equal(after.windows[0].remainingPercent, 60)
    assert.equal(svc.needsCredentialRetry('mistral'), false)
  } finally {
    if (prevApiKey !== undefined) process.env.MISTRAL_API_KEY = prevApiKey
    if (prevCookie !== undefined) process.env.MISTRAL_ADMIN_COOKIE = prevCookie
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pc-monitor calculates myTOKYOGAS rates, parses nvidia-smi, and tracks boot/today/month electricity cost', async () => {
  const dir = makeTmpDir()
  try {
    // Tier 2 default: (35.74 - 4.65) * 0.995 + 4.18 = 35.11455 -> 35.11 yen/kWh
    const t2 = calculateEffectiveYenPerKwh({
      tariffTier: 'tier2',
      fuelAdjustmentYen: -4.65,
      renewableSurchargeYen: 4.18,
      includeRenewableSurcharge: true,
      gasSetDiscount: true,
    })
    assert.equal(t2.tierId, 'tier2')
    assert.equal(t2.effectiveYenPerKwh, 35.11)

    const t3NoDiscount = calculateEffectiveYenPerKwh({
      tariffTier: 'tier3',
      fuelAdjustmentYen: 0,
      renewableSurchargeYen: 4.18,
      includeRenewableSurcharge: true,
      gasSetDiscount: false,
    })
    assert.equal(t3NoDiscount.effectiveYenPerKwh, 43.73)

    const gpu = parseNvidiaSmiCsv('NVIDIA GeForce RTX 5060 Ti, 12, 2496, 8151, 24.35, 180.00, 50')
    assert.equal(gpu.name, 'NVIDIA GeForce RTX 5060 Ti')
    assert.equal(gpu.utilPercent, 12)
    assert.equal(gpu.powerWatts, 24.4)
    assert.equal(gpu.tempC, 50)
    assert.equal(parseNvidiaSmiCsv(''), null)

    const watts = estimateSystemWatts({
      cpuPercent: 50,
      gpu,
      pcConfig: { baseSystemWatts: 55, cpuDynamicWatts: 85, extraWatts: 20, psuEfficiency: 0.88 },
    })
    // dc = 55 + 42.5 + 24.4 = 121.9; wall = 121.9 / 0.88 + 20 = 158.5
    assert.equal(watts.gpuMeasured, true)
    assert.equal(watts.wallWatts, 158.5)

    let cpuStep = 0
    const cpuSamples = [
      [{ model: 'Test CPU', times: { user: 100, nice: 0, sys: 0, idle: 900, irq: 0 } }],
      [{ model: 'Test CPU', times: { user: 200, nice: 0, sys: 0, idle: 1000, irq: 0 } }],
      [{ model: 'Test CPU', times: { user: 300, nice: 0, sys: 0, idle: 1100, irq: 0 } }],
    ]
    const baseTime = Date.UTC(2026, 10, 27, 1, 0, 0)
    let simNow = baseTime
    const monitor = createPcMonitor({
      dataDir: dir,
      getCpus: () => cpuSamples[Math.min(cpuStep++, cpuSamples.length - 1)],
      getTotalMem: () => 32 * 1024 ** 3,
      getFreeMem: () => 16 * 1024 ** 3,
      getUptime: () => 36000 + Math.floor((simNow - baseTime) / 1000),
      probeGpu: async () => gpu,
    })

    const s1 = await monitor.sample(
      {
        tariffTier: 'tier2',
        fuelAdjustmentYen: -4.65,
        renewableSurchargeYen: 4.18,
        includeRenewableSurcharge: true,
        gasSetDiscount: true,
        baseSystemWatts: 55,
        cpuDynamicWatts: 85,
        extraWatts: 0,
        psuEfficiency: 0.88,
      },
      simNow,
    )
    assert.equal(s1.status, 'ok')
    assert.equal(s1.cpu.percent, 50)
    assert.equal(s1.memory.percent, 50)
    assert.equal(s1.uptime.seconds, 36000)
    assert.ok(s1.energy.bootKwh > 1.0)
    assert.ok(s1.energy.bootYen > 30)

    simNow = baseTime + 60_000
    const s2 = await monitor.sample({ tariffTier: 'tier2' }, simNow)
    assert.ok(s2.energy.bootKwh > 0)
    assert.ok(s2.energy.monthKwh >= s2.energy.todayKwh)

    // Sleep gap (>120s) must not inflate today's accumulated energy.
    simNow = baseTime + 60_000 + 3 * 3600_000
    const s3 = await monitor.sample({ tariffTier: 'tier2' }, simNow)
    assert.ok(Math.abs(s3.energy.todayKwh - s2.energy.todayKwh) < 0.01)

    monitor.flush()
    const persisted = JSON.parse(readFileSync(monitor.energyFile, 'utf8'))
    assert.ok(persisted.bootTrackedSec >= 60)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
