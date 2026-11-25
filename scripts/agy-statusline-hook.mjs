#!/usr/bin/env node
/**
 * Antigravity CLI official `statusLine` hook for dsh-usage-limits.
 *
 * Reads the official statusLine JSON payload from stdin, extracts ONLY
 * non-sensitive quota & tier metadata (never tokens or personal email),
 * and writes an atomic snapshot to ~/.dsh/dsh-usage-limits/agy-quota-cache.json.
 * Always exits 0 so it never disrupts the Antigravity CLI TUI.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

function resolveCachePath() {
  const override = typeof process.env.DSH_USAGE_LIMITS_DATA_DIR === 'string' ? process.env.DSH_USAGE_LIMITS_DATA_DIR.trim() : ''
  const dir = override || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-usage-limits')
  return join(dir, 'agy-quota-cache.json')
}

function readExistingCache(cachePath) {
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function pickFiniteNumber(...vals) {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

function pickString(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  }
  return null
}

function sanitizeQuota(rawQuota) {
  if (!rawQuota || typeof rawQuota !== 'object' || Array.isArray(rawQuota)) return {}
  const out = {}
  for (const [bucketId, entry] of Object.entries(rawQuota)) {
    if (!entry || typeof entry !== 'object') continue
    const clean = {}
    const remFrac = pickFiniteNumber(entry.remaining_fraction, entry.remainingFraction)
    if (remFrac !== null) {
      clean.remaining_fraction = Math.max(0, Math.min(1, remFrac))
    }
    const remAmt = pickFiniteNumber(entry.remaining_amount, entry.remainingAmount)
    if (remAmt !== null) {
      clean.remaining_amount = remAmt
    }
    const resetTime = pickString(entry.reset_time, entry.resetTime)
    if (resetTime !== null) {
      clean.reset_time = resetTime
    }
    const resetSecs = pickFiniteNumber(entry.reset_in_seconds, entry.resetInSeconds)
    if (resetSecs !== null) {
      clean.reset_in_seconds = Math.max(0, Math.round(resetSecs))
    }
    if (typeof entry.disabled === 'boolean') {
      clean.disabled = entry.disabled
    }
    if (Object.keys(clean).length > 0) {
      out[String(bucketId).slice(0, 80)] = clean
    }
  }
  return out
}

function writeCacheSafe(cachePath, snapshot) {
  mkdirSync(dirname(cachePath), { recursive: true, mode: 0o700 })
  const json = JSON.stringify(snapshot, null, 2) + '\n'
  const tmp = `${cachePath}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(tmp, json, { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, cachePath)
  } catch {
    try {
      rmSync(tmp, { force: true })
    } catch {
      // Ignore cleanup error.
    }
    writeFileSync(cachePath, json, { encoding: 'utf8', mode: 0o600 })
  }
}

function main() {
  const chunks = []
  let totalBytes = 0
  const MAX_BYTES = 512 * 1024

  process.stdin.on('data', (chunk) => {
    totalBytes += chunk.length
    if (totalBytes <= MAX_BYTES) chunks.push(chunk)
  })

  process.stdin.on('end', () => {
    try {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) return
      const payload = JSON.parse(text)
      if (!payload || typeof payload !== 'object') return

      const cachePath = resolveCachePath()
      const cleanQuota = sanitizeQuota(payload.quota)
      const hasNewQuota = Object.keys(cleanQuota).length > 0
      const existing = hasNewQuota ? null : readExistingCache(cachePath)
      const existingQuota =
        existing && existing.quota && typeof existing.quota === 'object' ? existing.quota : {}
      const hasExistingQuota = Object.keys(existingQuota).length > 0

      // Do not clobber a populated quota snapshot with an early pre-auth empty payload.
      if (!hasNewQuota && hasExistingQuota) {
        return
      }

      const snapshot = {
        version: 1,
        updatedAt: Date.now(),
        cliVersion: pickString(payload.version),
        planTier: pickString(payload.plan_tier, payload.planTier, existing?.planTier),
        model: payload.model && typeof payload.model === 'object'
          ? {
              id: pickString(payload.model.id),
              displayName: pickString(payload.model.display_name, payload.model.displayName),
            }
          : existing?.model || null,
        quota: hasNewQuota ? cleanQuota : existingQuota,
      }

      writeCacheSafe(cachePath, snapshot)
    } catch {
      // Never fail Antigravity CLI statusLine rendering.
    }
  })

  process.stdin.on('error', () => {
    // Ignore stdin errors.
  })
}

main()
