import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { resolveDataDir, writeJsonAtomic } from './config-store.js'

const execFileAsync = promisify(execFile)

/**
 * myTOKYOGAS (Tokyo Gas "基本プラン") electricity rate tiers (tax-included,
 * Dec 2026 revision baseline). Fuel cost adjustment & renewable surcharge are
 * configurable in plugin settings because they change monthly / annually.
 */
export const TOKYO_GAS_TIERS = Object.freeze({
  tier1: { id: 'tier1', rateYenPerKwh: 29.75, rangeLabel: '≤120 kWh' },
  tier2: { id: 'tier2', rateYenPerKwh: 35.74, rangeLabel: '120–300 kWh' },
  tier3: { id: 'tier3', rateYenPerKwh: 39.55, rangeLabel: '>300 kWh' },
})

const MAX_INTEGRATION_GAP_SEC = 120
const MAX_STORED_DAYS = 45
const NVIDIA_TIMEOUT_MS = 2500

function clamp(n, min, max) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function round1(n) {
  return Math.round(n * 10) / 10
}

function round2(n) {
  return Math.round(n * 100) / 100
}

function round3(n) {
  return Math.round(n * 1000) / 1000
}

export function localDateKey(ms = Date.now()) {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function localMonthPrefix(ms = Date.now()) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-`
}

export function calculateEffectiveYenPerKwh(pcConfig = {}) {
  const tierKey = Object.hasOwn(TOKYO_GAS_TIERS, pcConfig.tariffTier) ? pcConfig.tariffTier : 'tier2'
  const tier = TOKYO_GAS_TIERS[tierKey]
  const custom = Number(pcConfig.customUnitYenPerKwh) || 0
  const baseRate = custom > 0 ? custom : tier.rateYenPerKwh
  const fuelAdj =
    pcConfig.fuelAdjustmentYen !== null &&
    pcConfig.fuelAdjustmentYen !== undefined &&
    Number.isFinite(Number(pcConfig.fuelAdjustmentYen))
      ? Number(pcConfig.fuelAdjustmentYen)
      : -4.65
  const includeRe = pcConfig.includeRenewableSurcharge !== false
  const reSurcharge =
    includeRe &&
    pcConfig.renewableSurchargeYen !== null &&
    pcConfig.renewableSurchargeYen !== undefined &&
    Number.isFinite(Number(pcConfig.renewableSurchargeYen))
      ? Number(pcConfig.renewableSurchargeYen)
      : 0
  const gasSetDiscount = pcConfig.gasSetDiscount !== false

  // Tokyo Gas 0.5% gas+electricity set discount applies to the energy charge
  // (base rate + fuel cost adjustment), excluding the statutory renewable surcharge.
  const energyPart = baseRate + fuelAdj
  const discountedEnergy = gasSetDiscount ? energyPart * 0.995 : energyPart
  const effective = Math.max(0, discountedEnergy + reSurcharge)

  return {
    tierId: custom > 0 ? 'custom' : tier.id,
    baseRateYen: round2(baseRate),
    fuelAdjustmentYen: round2(fuelAdj),
    renewableSurchargeYen: round2(reSurcharge),
    gasSetDiscount,
    effectiveYenPerKwh: round2(effective),
  }
}

export function estimateSystemWatts({ cpuPercent = 0, gpu = null, pcConfig = {} }) {
  const cpuFrac = clamp(Number(cpuPercent) || 0, 0, 100) / 100
  const baseSystemWatts = clamp(Number(pcConfig.baseSystemWatts ?? 55), 1, 500)
  const cpuDynamicWatts = clamp(Number(pcConfig.cpuDynamicWatts ?? 85), 0, 500)
  const extraWatts = clamp(Number(pcConfig.extraWatts ?? 0), 0, 1000)
  const psuEfficiency = clamp(Number(pcConfig.psuEfficiency ?? 0.88), 0.5, 1)

  const gpuWatts = gpu && typeof gpu.powerWatts === 'number' && Number.isFinite(gpu.powerWatts) && gpu.powerWatts >= 0
    ? gpu.powerWatts
    : 0
  const gpuMeasured = gpu && typeof gpu.powerWatts === 'number' && Number.isFinite(gpu.powerWatts)

  const cpuWatts = cpuDynamicWatts * cpuFrac
  const dcWatts = baseSystemWatts + cpuWatts + gpuWatts
  const wallWatts = dcWatts / psuEfficiency + extraWatts

  return {
    wallWatts: round1(wallWatts),
    dcWatts: round1(dcWatts),
    gpuWatts: round1(gpuWatts),
    gpuMeasured: Boolean(gpuMeasured),
  }
}

export function parseNvidiaSmiCsv(output) {
  if (typeof output !== 'string' || !output.trim()) return null
  const firstLine = output.trim().split(/\r?\n/)[0]
  if (!firstLine) return null
  const parts = firstLine.split(',').map((s) => s.trim())
  if (parts.length < 7) return null

  const toNum = (s) => {
    const v = Number(s)
    return Number.isFinite(v) ? v : null
  }

  const name = parts[0] || 'NVIDIA GPU'
  const utilPercent = toNum(parts[1])
  const vramUsedMb = toNum(parts[2])
  const vramTotalMb = toNum(parts[3])
  const powerWatts = toNum(parts[4])
  const powerLimitWatts = toNum(parts[5])
  const tempC = toNum(parts[6])

  return {
    name,
    utilPercent: utilPercent !== null ? clamp(round1(utilPercent), 0, 100) : null,
    vramUsedMb: vramUsedMb !== null ? Math.round(vramUsedMb) : null,
    vramTotalMb: vramTotalMb !== null ? Math.round(vramTotalMb) : null,
    vramPercent:
      vramUsedMb !== null && vramTotalMb !== null && vramTotalMb > 0
        ? clamp(round1((vramUsedMb / vramTotalMb) * 100), 0, 100)
        : null,
    powerWatts: powerWatts !== null ? round1(powerWatts) : null,
    powerLimitWatts: powerLimitWatts !== null ? round1(powerLimitWatts) : null,
    tempC: tempC !== null ? Math.round(tempC) : null,
  }
}

function snapshotCpuTimes(cpus) {
  let idle = 0
  let total = 0
  for (const cpu of cpus) {
    if (!cpu || !cpu.times) continue
    const t = cpu.times
    idle += Number(t.idle) || 0
    total += (Number(t.user) || 0) + (Number(t.nice) || 0) + (Number(t.sys) || 0) + (Number(t.idle) || 0) + (Number(t.irq) || 0)
  }
  return { idle, total }
}

function emptyEnergyStore() {
  return {
    version: 1,
    bootAtMs: null,
    lastSampleAtMs: null,
    bootMeasuredWh: 0,
    bootTrackedSec: 0,
    days: {},
  }
}

function normalizeEnergyStore(raw) {
  const base = emptyEnergyStore()
  if (!raw || typeof raw !== 'object') return base
  if (typeof raw.bootAtMs === 'number' && Number.isFinite(raw.bootAtMs)) base.bootAtMs = raw.bootAtMs
  if (typeof raw.lastSampleAtMs === 'number' && Number.isFinite(raw.lastSampleAtMs)) base.lastSampleAtMs = raw.lastSampleAtMs
  if (typeof raw.bootMeasuredWh === 'number' && Number.isFinite(raw.bootMeasuredWh) && raw.bootMeasuredWh >= 0) {
    base.bootMeasuredWh = raw.bootMeasuredWh
  }
  if (typeof raw.bootTrackedSec === 'number' && Number.isFinite(raw.bootTrackedSec) && raw.bootTrackedSec >= 0) {
    base.bootTrackedSec = raw.bootTrackedSec
  }
  if (raw.days && typeof raw.days === 'object' && !Array.isArray(raw.days)) {
    for (const [k, v] of Object.entries(raw.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v || typeof v !== 'object') continue
      const wh = Number(v.wh)
      const sec = Number(v.sec)
      const firstAt = typeof v.firstTrackedAtMs === 'number' && Number.isFinite(v.firstTrackedAtMs) ? v.firstTrackedAtMs : null
      if (Number.isFinite(wh) && wh >= 0) {
        base.days[k] = { wh, sec: Number.isFinite(sec) && sec >= 0 ? sec : 0, firstTrackedAtMs: firstAt }
      }
    }
  }
  return base
}

export function createPcMonitor(options = {}) {
  const dataDir = options.dataDir || resolveDataDir()
  const energyFile = join(dataDir, 'pc-energy.json')
  const getCpus = typeof options.getCpus === 'function' ? options.getCpus : () => os.cpus()
  const getTotalMem = typeof options.getTotalMem === 'function' ? options.getTotalMem : () => os.totalmem()
  const getFreeMem = typeof options.getFreeMem === 'function' ? options.getFreeMem : () => os.freemem()
  const getUptime = typeof options.getUptime === 'function' ? options.getUptime : () => os.uptime()
  const probeGpu = typeof options.probeGpu === 'function' ? options.probeGpu : defaultProbeNvidiaGpu

  let store = loadEnergyStore()
  let prevCpu = null
  let nvidiaUnavailable = false
  let nvidiaFailStreak = 0
  let lastSnapshot = null
  let saveTimer = null
  let dirty = false

  function loadEnergyStore() {
    try {
      const raw = readFileSync(energyFile, 'utf8')
      return normalizeEnergyStore(JSON.parse(raw))
    } catch {
      return emptyEnergyStore()
    }
  }

  function pruneOldDays() {
    const keys = Object.keys(store.days).sort()
    if (keys.length <= MAX_STORED_DAYS) return
    const drop = keys.slice(0, keys.length - MAX_STORED_DAYS)
    for (const k of drop) delete store.days[k]
  }

  function scheduleSave() {
    dirty = true
    if (saveTimer !== null) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      flush()
    }, 5000)
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
      pruneOldDays()
      writeJsonAtomic(energyFile, store)
    } catch {
      // Best-effort local persistence.
    }
  }

  async function defaultProbeNvidiaGpu() {
    if (nvidiaUnavailable) return null
    try {
      const { stdout } = await execFileAsync(
        'nvidia-smi',
        [
          '--query-gpu=name,utilization.gpu,memory.used,memory.total,power.draw,power.limit,temperature.gpu',
          '--format=csv,noheader,nounits',
        ],
        { timeout: NVIDIA_TIMEOUT_MS, windowsHide: true },
      )
      nvidiaFailStreak = 0
      return parseNvidiaSmiCsv(stdout)
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'EACCES')) {
        nvidiaUnavailable = true
      } else if (err && (err.code === 'ETIMEDOUT' || err.killed)) {
        nvidiaFailStreak += 1
        if (nvidiaFailStreak >= 3) {
          nvidiaUnavailable = true
        }
      }
      return null
    }
  }

  async function readCpuPercent() {
    const cpus = getCpus()
    const current = snapshotCpuTimes(cpus)
    if (!prevCpu) {
      prevCpu = current
      await new Promise((resolve) => setTimeout(resolve, 120))
      const next = snapshotCpuTimes(getCpus())
      const idleDiff = Math.max(0, next.idle - prevCpu.idle)
      const totalDiff = Math.max(0, next.total - prevCpu.total)
      prevCpu = next
      return totalDiff > 0 ? clamp(round1(((totalDiff - idleDiff) / totalDiff) * 100), 0, 100) : 0
    }
    const idleDiff = Math.max(0, current.idle - prevCpu.idle)
    const totalDiff = Math.max(0, current.total - prevCpu.total)
    prevCpu = current
    if (totalDiff <= 0) return lastSnapshot?.cpu?.percent ?? 0
    return clamp(round1(((totalDiff - idleDiff) / totalDiff) * 100), 0, 100)
  }

  async function sample(pcConfig = {}, nowMs = Date.now()) {
    const [cpuPercent, gpu] = await Promise.all([readCpuPercent(), probeGpu()])
    const cpus = getCpus()
    const cpuModel = typeof cpus[0]?.model === 'string' ? cpus[0].model.trim() : 'CPU'
    const cpuThreads = Array.isArray(cpus) ? cpus.length : 0

    const totalMemBytes = Math.max(1, Number(getTotalMem()) || 1)
    const freeMemBytes = clamp(Number(getFreeMem()) || 0, 0, totalMemBytes)
    const usedMemBytes = Math.max(0, totalMemBytes - freeMemBytes)
    const memoryPercent = clamp(round1((usedMemBytes / totalMemBytes) * 100), 0, 100)
    const gb = 1024 ** 3

    const uptimeSec = Math.max(0, Math.floor(Number(getUptime()) || 0))
    const bootAtMs = Math.round(nowMs - uptimeSec * 1000)

    const power = estimateSystemWatts({ cpuPercent, gpu, pcConfig })
    const tariff = calculateEffectiveYenPerKwh(pcConfig)

    const todayKey = localDateKey(nowMs)
    if (!store.days[todayKey]) {
      store.days[todayKey] = { wh: 0, sec: 0, firstTrackedAtMs: nowMs }
      scheduleSave()
    } else if (store.days[todayKey].firstTrackedAtMs === null || store.days[todayKey].firstTrackedAtMs === undefined) {
      store.days[todayKey].firstTrackedAtMs = nowMs
      scheduleSave()
    }

    // Detect OS reboot (> 60s shift in computed boot timestamp).
    if (store.bootAtMs === null || Math.abs(bootAtMs - store.bootAtMs) > 60_000) {
      store.bootAtMs = bootAtMs
      store.bootMeasuredWh = 0
      store.bootTrackedSec = 0
      store.lastSampleAtMs = nowMs
      scheduleSave()
    } else if (store.lastSampleAtMs !== null) {
      const deltaSec = (nowMs - store.lastSampleAtMs) / 1000
      if (deltaSec > 0 && deltaSec <= MAX_INTEGRATION_GAP_SEC) {
        const addedWh = (power.wallWatts * deltaSec) / 3600
        store.bootMeasuredWh += addedWh
        store.bootTrackedSec += deltaSec
        store.days[todayKey].wh += addedWh
        store.days[todayKey].sec += deltaSec
        scheduleSave()
      }
      store.lastSampleAtMs = nowMs
    } else {
      store.lastSampleAtMs = nowMs
    }

    // Boot total Wh combines tracked Wh + average-power backfill for uptime before DSH started.
    const bootAvgWatts = store.bootTrackedSec >= 60
      ? (store.bootMeasuredWh * 3600) / store.bootTrackedSec
      : power.wallWatts
    const untrackedBootSec = Math.max(0, uptimeSec - store.bootTrackedSec)
    const bootTotalWh = store.bootMeasuredWh + (bootAvgWatts * untrackedBootSec) / 3600
    const bootKwh = bootTotalWh / 1000

    // For today, backfill only the pre-DSH window [max(bootAt, 00:00), firstTrackedAtMs]
    // so subsequent sleep/suspend gaps (> MAX_INTEGRATION_GAP_SEC) are never inflated as active usage.
    const todayTrackedWh = store.days[todayKey]?.wh || 0
    const startOfTodayMs = new Date(nowMs).setHours(0, 0, 0, 0)
    const todayWindowStartMs = Math.max(bootAtMs, startOfTodayMs)
    const firstTodayMs = Math.min(nowMs, Math.max(todayWindowStartMs, store.days[todayKey].firstTrackedAtMs || nowMs))
    const preTrackingTodaySec = Math.max(0, Math.floor((firstTodayMs - todayWindowStartMs) / 1000))
    const todayTotalWh = todayTrackedWh + (bootAvgWatts * preTrackingTodaySec) / 3600
    const todayKwh = todayTotalWh / 1000

    const monthPrefix = localMonthPrefix(nowMs)
    let monthOtherDaysWh = 0
    for (const [k, v] of Object.entries(store.days)) {
      if (k.startsWith(monthPrefix) && k !== todayKey) {
        monthOtherDaysWh += Number(v.wh) || 0
      }
    }
    const startOfMonth = new Date(nowMs)
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)
    const bootInThisMonthSec = Math.max(0, Math.floor((nowMs - Math.max(bootAtMs, startOfMonth.getTime())) / 1000))
    const bootInThisMonthWh = uptimeSec > 0 ? bootTotalWh * (bootInThisMonthSec / uptimeSec) : bootTotalWh
    const monthKwh = Math.max(monthOtherDaysWh + todayTotalWh, bootInThisMonthWh) / 1000

    const unitRate = tariff.effectiveYenPerKwh
    const hourlyYen = round2((power.wallWatts / 1000) * unitRate)

    lastSnapshot = {
      enabled: true,
      status: 'ok',
      fetchedAt: nowMs,
      hostname: os.hostname(),
      platform: process.platform,
      cpu: {
        model: cpuModel,
        threads: cpuThreads,
        percent: cpuPercent,
      },
      memory: {
        percent: memoryPercent,
        usedGb: round1(usedMemBytes / gb),
        totalGb: round1(totalMemBytes / gb),
      },
      gpu,
      uptime: {
        seconds: uptimeSec,
        bootAtMs,
      },
      power: {
        wallWatts: power.wallWatts,
        gpuWatts: power.gpuWatts,
        gpuMeasured: power.gpuMeasured,
        hourlyYen,
      },
      tariff,
      energy: {
        bootKwh: round3(bootKwh),
        bootYen: round1(bootKwh * unitRate),
        bootMeasuredRatio: uptimeSec > 0 ? clamp(round2(store.bootTrackedSec / uptimeSec), 0, 1) : 1,
        todayKwh: round3(todayKwh),
        todayYen: round1(todayKwh * unitRate),
        monthKwh: round3(monthKwh),
        monthYen: round1(monthKwh * unitRate),
      },
    }

    return lastSnapshot
  }

  function getLastSnapshot() {
    return lastSnapshot
  }

  return {
    energyFile,
    sample,
    getLastSnapshot,
    flush,
  }
}
