import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDataDir, writeJsonAtomic } from './config-store.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const HOOK_MARKER = 'agy-statusline-hook.mjs'
export const HOOK_WRAPPER_MARKER = 'agy-statusline-hook.cmd'

export function resolveAgySettingsPath(home = homedir()) {
  return join(home, '.gemini', 'antigravity-cli', 'settings.json')
}

export function resolveHookScriptPath() {
  return resolve(__dirname, '..', 'scripts', HOOK_MARKER)
}

export function resolveDefaultNodeExec() {
  try {
    const execPath = typeof process.execPath === 'string' ? process.execPath : ''
    if (execPath && basename(execPath).toLowerCase().startsWith('node')) {
      return execPath
    }
  } catch {
    // Fall back to PATH lookup.
  }
  return 'node'
}

function isOurHookCommand(cmd) {
  return typeof cmd === 'string' && (cmd.includes(HOOK_MARKER) || cmd.includes(HOOK_WRAPPER_MARKER))
}

function hasWhitespace(value) {
  return /\s/.test(String(value || ''))
}

/**
 * Builds the `statusLine.command` string.
 *
 * On Windows, Antigravity CLI executes `statusLine.command` via Go's
 * `exec.Command("cmd", "/c", command)`, which escapes embedded `"` into `\"`
 * and breaks quoted arguments passed to `node.exe`. Therefore:
 *  - When neither `nodeExec` nor `scriptPath` contains whitespace, emit an
 *    unquoted command on every platform.
 *  - On Windows when either path contains whitespace, emit a `.cmd` wrapper
 *    (if `writeWrapper` is enabled) so `settings.json` stays quote-free.
 */
export function buildHookCommand(scriptPath = resolveHookScriptPath(), nodeExec = resolveDefaultNodeExec(), options = {}) {
  const platform = options.platform || process.platform
  const nodeHasSpace = hasWhitespace(nodeExec)
  const scriptHasSpace = hasWhitespace(scriptPath)

  if (!nodeHasSpace && !scriptHasSpace) {
    return `${nodeExec} ${scriptPath}`
  }

  if (platform === 'win32') {
    const wrapperDir = options.dataDir || resolveDataDir()
    const wrapperPath = join(wrapperDir, HOOK_WRAPPER_MARKER)
    if (options.writeWrapper === true) {
      mkdirSync(wrapperDir, { recursive: true })
      const content = `@echo off\r\n"${nodeExec}" "${scriptPath}"\r\n`
      writeFileSync(wrapperPath, content, 'utf8')
    }
    return wrapperPath
  }

  const quotedNode = nodeHasSpace ? `"${nodeExec}"` : nodeExec
  const quotedScript = scriptHasSpace ? `"${scriptPath}"` : scriptPath
  return `${quotedNode} ${quotedScript}`
}

export function inspectAgyHook(options = {}) {
  const settingsPath = options.settingsPath || resolveAgySettingsPath()
  const scriptPath = options.scriptPath || resolveHookScriptPath()
  const nodeExec = options.nodeExec || resolveDefaultNodeExec()
  const platform = options.platform || process.platform
  const expectedCommand = buildHookCommand(scriptPath, nodeExec, {
    platform,
    dataDir: options.dataDir,
    writeWrapper: false,
  })

  if (!existsSync(settingsPath)) {
    return {
      settingsExists: false,
      installed: false,
      needsRepair: false,
      customStatusLinePresent: false,
      settingsPath,
      expectedCommand,
    }
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
    const sl = parsed && typeof parsed === 'object' ? parsed.statusLine : undefined
    const cmd = sl && typeof sl === 'object' && typeof sl.command === 'string' ? sl.command : ''
    const ours = isOurHookCommand(cmd)
    const needsRepair = ours && platform === 'win32' && cmd.includes('"')
    const installed = ours && sl?.enabled !== false && !needsRepair
    const customStatusLinePresent = Boolean(cmd) && !ours
    return {
      settingsExists: true,
      installed,
      needsRepair,
      customStatusLinePresent,
      currentCommand: cmd || null,
      settingsPath,
      expectedCommand,
    }
  } catch (err) {
    return {
      settingsExists: true,
      installed: false,
      needsRepair: false,
      customStatusLinePresent: false,
      parseError: err instanceof Error ? err.message : String(err),
      settingsPath,
      expectedCommand,
    }
  }
}

export function installAgyHook(options = {}) {
  const settingsPath = options.settingsPath || resolveAgySettingsPath()
  const scriptPath = options.scriptPath || resolveHookScriptPath()
  const nodeExec = options.nodeExec || resolveDefaultNodeExec()
  const platform = options.platform || process.platform
  const command = buildHookCommand(scriptPath, nodeExec, {
    platform,
    dataDir: options.dataDir,
    writeWrapper: true,
  })

  let current = {}
  if (existsSync(settingsPath)) {
    const raw = readFileSync(settingsPath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('~/.gemini/antigravity-cli/settings.json is not a JSON object.')
    }
    current = parsed
  }

  const existingCmd =
    current.statusLine && typeof current.statusLine === 'object' && typeof current.statusLine.command === 'string'
      ? current.statusLine.command
      : ''

  if (existingCmd && !isOurHookCommand(existingCmd) && options.force !== true) {
    return {
      ok: false,
      code: 'CUSTOM_STATUSLINE_EXISTS',
      message: 'A custom statusLine command is already configured in ~/.gemini/antigravity-cli/settings.json.',
      currentCommand: existingCmd,
      expectedCommand: command,
    }
  }

  const next = {
    ...current,
    statusLine: {
      type: 'command',
      command,
      enabled: true,
      stack_with_default: true,
    },
  }
  writeJsonAtomic(settingsPath, next)
  return {
    ok: true,
    installed: true,
    settingsPath,
    command,
  }
}

export function uninstallAgyHook(options = {}) {
  const settingsPath = options.settingsPath || resolveAgySettingsPath()
  if (!existsSync(settingsPath)) {
    return { ok: true, installed: false }
  }
  const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: true, installed: false }
  }
  const cmd =
    parsed.statusLine && typeof parsed.statusLine === 'object' && typeof parsed.statusLine.command === 'string'
      ? parsed.statusLine.command
      : ''
  if (!isOurHookCommand(cmd)) {
    return { ok: true, installed: false, untouched: true }
  }
  const next = { ...parsed }
  delete next.statusLine
  writeJsonAtomic(settingsPath, next)
  if (cmd.includes(HOOK_WRAPPER_MARKER)) {
    try {
      rmSync(join(options.dataDir || resolveDataDir(), HOOK_WRAPPER_MARKER), { force: true })
    } catch {
      // Ignore wrapper cleanup error.
    }
  }
  return { ok: true, installed: false }
}
