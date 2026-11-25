/**
 * dsh-usage-limits — Browser UI half.
 *
 * Visual language modeled after `dsh-mistral-pro`:
 *  - Borderless, hover-revealed footer rows stacked cleanly inside
 *    `sidebar.footer.action` (with `[class*="_footArea"] [class*="_footerActions"]`
 *    column stacking) and a minimalist SVG ring button in the 56px rail.
 *  - Split center-divided progress bar when a provider has 2 windows (e.g. `5h`
 *    on the left half and `week` on the right half), plus an independent
 *    toggleable `Claude (AGY)` sidebar row for Antigravity's partner pool.
 *  - High-contrast `bg-layer-1` canvas with `bg-layer-3` cards, full-width
 *    horizontal quota bars, and `bg-layer-1` metric tiles in the `main` panel
 *    and `plugins.bundle.config` surface.
 *
 * Uses only `react` from the browser module table and `--dsw-alias-*` theme tokens.
 */
window.__ModuleLoader__.load({
  id: 'dsh-usage-limits',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useMemo } = React

    const PLUGIN_ID = 'dsh-usage-limits'
    const PANEL_ID = 'dsh-usage-limits-panel'
    const ROUTE_PREFIX = '/_dsh/dsh-usage-limits'
    const STYLE_ID = 'dsh-usage-limits/usage.module.css'

    const DICT = {
      en: {
        title: 'Usage limits',
        subtitle: 'ChatGPT · Claude · Gemini (Antigravity) · Mistral',
        summary: 'Displays ChatGPT, Claude, Gemini (Antigravity), and Mistral usage limits in the left sidebar footer.',
        refresh: 'Refresh',
        refreshing: 'Refreshing…',
        close: 'Close',
        remaining: 'left',
        used: 'used',
        allOff: 'All off',
        loading: 'Loading…',
        unconfigured: 'Not set up',
        authExpired: 'Re-login',
        rateLimited: 'Limit reached',
        error: 'Unavailable',
        stale: 'Cached',
        disabled: 'Off',
        resetIn: 'Resets in {left}',
        updated: 'Updated {time}',
        noWindows: 'No quota windows reported yet.',
        providersBar: 'Visible providers',
        settingsTitle: 'Settings',
        displayMode: 'Percentage display',
        modeRemaining: 'Remaining %',
        modeUsed: 'Used %',
        refreshInterval: 'Refresh interval (sec)',
        save: 'Save',
        saved: 'Saved.',
        partnerGroup: 'Partner models (Claude / GPT)',
        partnerRowName: 'Claude (AGY)',
        partnerFull: 'Claude (AGY) / GPT-OSS',
        creditGroup: 'Credits',
        credits: 'Credits',
        monthSpend: 'Spend this month',
        sourceApi: 'Live API',
        sourceStatusline: 'Antigravity statusLine',
        sourceCookie: 'Admin Cookie',
        sourceApiCookie: 'API + Cookie',
        sourceTracker: 'DSH local tracker',
        dshUsage5h: 'DSH 5h',
        dshUsage7d: 'DSH 7d',
        dshUsageToday: 'DSH today',
        dshUsageMonth: 'DSH month',
        requestsUnit: 'req',
        tokensUnit: 'tok',
        openDashboard: 'Official usage page',
        agyHookTitle: 'Antigravity statusLine quota sync',
        agyHookInstalled: 'Enabled in ~/.gemini/antigravity-cli/settings.json',
        agyHookNotInstalled: 'Enable the official statusLine hook to sync real Gemini & partner model quotas.',
        agyHookCustomConflict: 'A custom statusLine already exists in settings.json.',
        agyHookInstall: 'Enable hook',
        agyHookUninstall: 'Disable hook',
        agyHookWaiting: 'Run `agy` once in a terminal to write the initial quota snapshot (DSH ACP alone does not trigger TUI statusLine).',
        agyUnsynced: 'Run `agy` to sync',
        mistralCookieTitle: 'Mistral Admin Cookie (optional)',
        mistralCookieHint: 'Fallback when MISTRAL_API_KEY cannot read /v1/billing/budget, or to show credits and spend. Stored in DSH credentials (.credentials.yaml); never returned to the browser.',
        mistralCookieConfigured: 'Configured',
        mistralCookieMissing: 'Not set',
        mistralCookiePlaceholder: 'Paste Cookie header from admin.mistral.ai (ory_session_…)',
        mistralCookieSave: 'Save cookie',
        mistralCookieClear: 'Clear',
        budgetHint: 'Optional local token budgets when no live quota API is active (0 = off)',
        budget5h: 'Gemini 5h tokens',
        budgetWeekly: 'Gemini weekly tokens',
        budgetMonthly: 'Mistral monthly tokens',
        claudeFutureNote: 'Turn Claude ON once Claude Code is installed and signed in (`claude login`).',
        providerName_chatgpt: 'ChatGPT',
        providerName_claude: 'Claude',
        providerName_gemini: 'Gemini',
        providerName_mistral: 'Mistral',
        window_5h: '5-hour window',
        window_weekly: 'Weekly window',
        window_monthly: 'Monthly budget',
        windowShort_5h: '5h',
        windowShort_weekly: 'week',
        windowShort_monthly: 'mo',
      },
      ja: {
        title: '利用上限',
        subtitle: 'ChatGPT · Claude · Gemini（Antigravity）· Mistral',
        summary: '左サイドバー下部に ChatGPT・Claude・Gemini（Antigravity）・Mistral の利用上限を表示します。',
        refresh: '更新',
        refreshing: '更新中…',
        close: '閉じる',
        remaining: '残',
        used: '使用',
        allOff: 'すべて OFF',
        loading: '読込中…',
        unconfigured: '未連携',
        authExpired: '要再認証',
        rateLimited: '上限到達',
        error: '取得失敗',
        stale: '前回値',
        disabled: 'OFF',
        resetIn: 'リセットまで {left}',
        updated: '更新 {time}',
        noWindows: 'クォータ枠のデータはまだありません。',
        providersBar: '表示するプロバイダー（ON / OFF）',
        settingsTitle: '設定・連携',
        displayMode: '％の表示向き',
        modeRemaining: '残量％（残り）',
        modeUsed: '使用率％（消費）',
        refreshInterval: '更新間隔（秒）',
        save: '保存',
        saved: '保存しました。',
        partnerGroup: 'パートナー枠（Claude / GPT 等）',
        partnerRowName: 'Claude (AGY)',
        partnerFull: 'Claude (AGY) / GPT-OSS',
        creditGroup: 'クレジット',
        credits: 'クレジット残高',
        monthSpend: '今月の利用額',
        sourceApi: 'API 実測',
        sourceStatusline: 'Antigravity 公式 statusLine',
        sourceCookie: '管理画面 Cookie',
        sourceApiCookie: 'API + Cookie',
        sourceTracker: 'DSH ローカル集計',
        dshUsage5h: 'DSH 5時間',
        dshUsage7d: 'DSH 7日間',
        dshUsageToday: 'DSH 本日',
        dshUsageMonth: 'DSH 今月',
        requestsUnit: '回',
        tokensUnit: 'tok',
        openDashboard: '公式ページ',
        agyHookTitle: 'Antigravity 公式 statusLine 連携',
        agyHookInstalled: '~/.gemini/antigravity-cli/settings.json に設定済み',
        agyHookNotInstalled: '公式 statusLine フックを有効にすると、Gemini 枠とパートナー枠の実測％を同期します。',
        agyHookCustomConflict: 'settings.json に既存のカスタム statusLine が設定されています。',
        agyHookInstall: 'フックを有効化',
        agyHookUninstall: 'フックを解除',
        agyHookWaiting: 'ターミナルで一度 `agy` を開くと実測％を自動同期します（DSH の ACP 経由だけでは TUI の statusLine が発火しないため）。',
        agyUnsynced: 'agy 未同期',
        mistralCookieTitle: 'Mistral 管理画面 Cookie（任意）',
        mistralCookieHint: 'MISTRAL_API_KEY で /v1/billing/budget を読めない場合や、クレジット残高・当月利用額を表示したい場合に設定します。値は DSH 認証情報ストア（.credentials.yaml）に保存され、ブラウザへは返しません。',
        mistralCookieConfigured: '設定済み',
        mistralCookieMissing: '未設定',
        mistralCookiePlaceholder: 'admin.mistral.ai の Cookie ヘッダーを貼り付け (ory_session_…)',
        mistralCookieSave: 'Cookie を保存',
        mistralCookieClear: '削除',
        budgetHint: '実測クォータ未取得時のローカル目安上限トークン数（0 = 無効）',
        budget5h: 'Gemini 5時間目安',
        budgetWeekly: 'Gemini 週間目安',
        budgetMonthly: 'Mistral 月間目安',
        claudeFutureNote: '将来 Claude Code を導入して `claude login` を実行したら、上のスイッチで Claude を ON にしてください。',
        providerName_chatgpt: 'ChatGPT',
        providerName_claude: 'Claude',
        providerName_gemini: 'Gemini',
        providerName_mistral: 'Mistral',
        window_5h: '5時間枠',
        window_weekly: '週間枠',
        window_monthly: '月間予算',
        windowShort_5h: '5h',
        windowShort_weekly: 'week',
        windowShort_monthly: '月',
      },
    }

    const CSS = `
[class*="_footArea"] [class*="_footerActions"]{flex-direction:column}

.ul-footGroup{box-sizing:border-box;flex:0 0 auto;width:100%;min-width:0;display:flex;flex-direction:column;gap:2px;margin:0 0 4px}
.ul-foot{box-sizing:border-box;flex:0 0 auto;width:100%;min-width:0;font:inherit;color:var(--dsw-alias-label-secondary);text-align:left;cursor:pointer;background:0 0;border:1px solid transparent;border-radius:10px;flex-direction:column;gap:5px;margin:0;padding:7px 8px;display:flex;transition:background .15s ease,border-color .15s ease,color .15s ease}
.ul-foot:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.ul-foot:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.ul-footTop{align-items:baseline;gap:4px;min-width:0;display:flex}
.ul-footName{white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;font-size:13px;font-weight:500;line-height:19px}
.ul-footSub{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;white-space:nowrap}
.ul-footMetrics{flex:none;display:inline-flex;align-items:baseline;gap:6px;white-space:nowrap}
.ul-footMetric{display:inline-flex;align-items:baseline;gap:3px;font-variant-numeric:tabular-nums;white-space:nowrap}
.ul-footMetricLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.ul-footPct{flex:none;color:var(--dsw-alias-label-secondary);text-align:right;font-size:12px;font-weight:500;line-height:16px;font-variant-numeric:tabular-nums;white-space:nowrap}
.ul-footPct--warn{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary))}
.ul-footPct--danger{color:var(--dsw-alias-state-error-primary)}
.ul-footBar{display:flex;background:var(--dsw-alias-bg-layer-2);border-radius:999px;height:5px;overflow:hidden;width:100%;min-width:0}
.ul-footBarSplit{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:4px;width:100%;min-width:0}
.ul-footBarDivider{width:1px;height:7px;background:var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));border-radius:1px;flex:none}
.ul-footSeg{flex:0 0 auto;display:block;height:100%;border-radius:999px;transition:width .3s ease}
.ul-footSeg--normal{background:var(--dsw-alias-label-primary)}
.ul-footSeg--secondary{background:var(--dsw-alias-label-tertiary)}
.ul-footSeg--warn{background:var(--dsw-alias-state-warn-primary)}
.ul-footSeg--danger{background:var(--dsw-alias-state-error-primary)}
.ul-spacer{flex:1}

.ul-railButton{box-sizing:border-box;width:36px;height:36px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:1px solid transparent;border-radius:8px;flex:none;justify-content:center;align-items:center;margin:0 0 4px;padding:0;display:inline-flex}
.ul-railButton:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.ul-railButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.ul-glyph{flex:none;justify-content:center;align-items:center;display:inline-flex;color:var(--dsw-alias-label-secondary)}

.ul-main{background:var(--dsw-alias-bg-layer-1);width:100%;height:100%;overflow:auto;display:block}
.ul-main--embedded{background:transparent;height:auto;overflow:visible}
.ul-mainInner{max-width:760px;margin:0 auto;padding:24px 20px 40px;flex-direction:column;gap:14px;display:flex;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
.ul-main--embedded .ul-mainInner{max-width:none;padding:0}
.ul-header{align-items:flex-start;gap:10px;display:flex;flex-wrap:wrap}
.ul-headerText{flex-direction:column;gap:2px;display:flex;min-width:0}
.ul-title{margin:0;font-size:18px;font-weight:600;line-height:1.4}
.ul-subtitle{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.ul-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;font-variant-numeric:tabular-nums}
.ul-btn{box-sizing:border-box;font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 10px;font-size:12px;line-height:18px;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap}
.ul-btn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.ul-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.ul-btn:disabled{opacity:.5;cursor:default}
.ul-btn--active{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-selected,var(--dsw-alias-label-secondary));background:var(--dsw-alias-interactive-bg-hover)}
.ul-btn--danger{color:var(--dsw-alias-state-error-primary)}

.ul-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:14px;padding:16px 18px;flex-direction:column;gap:14px;display:flex}
.ul-cardHead{align-items:center;gap:8px;display:flex;flex-wrap:wrap;min-width:0}
.ul-cardTitle{margin:0;font-size:14px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.ul-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.ul-badge--warn{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary))}
.ul-badge--danger{color:var(--dsw-alias-state-error-primary)}
.ul-badge--ok{color:var(--dsw-alias-state-success-primary)}

.ul-blockTitle{margin:2px 0 0;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600;line-height:1.5;text-transform:uppercase;letter-spacing:.04em}

.ul-windows{flex-direction:column;gap:12px;display:flex}
.ul-window{flex-direction:column;gap:5px;display:flex}
.ul-windowHead{align-items:baseline;gap:8px;display:flex}
.ul-windowLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:1.5}
.ul-windowValue{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;font-variant-numeric:tabular-nums;white-space:nowrap}
.ul-windowPct{color:var(--dsw-alias-label-primary);min-width:42px;text-align:right;font-size:12px;font-weight:600;line-height:1.5;font-variant-numeric:tabular-nums}
.ul-windowPct--warn{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary))}
.ul-windowPct--danger{color:var(--dsw-alias-state-error-primary)}
.ul-bar{overflow:hidden;background:var(--dsw-alias-bg-layer-1);border-radius:999px;height:5px}
.ul-barFill{height:100%;border-radius:999px;transition:width .3s ease}
.ul-windowReset{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:1.4}

.ul-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
.ul-tile{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:8px;padding:8px 10px;flex-direction:column;gap:2px;display:flex;min-width:0}
.ul-tileLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.4}
.ul-tileValue{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.35;font-variant-numeric:tabular-nums}
.ul-tileSub{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.ul-toggleBar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ul-toggleChip{box-sizing:border-box;font:inherit;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:5px 12px;font-size:12px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;gap:7px;transition:background .15s ease,border-color .15s ease,color .15s ease}
.ul-toggleChip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.ul-toggleChip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.ul-toggleChip[aria-checked="true"]{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary)}
.ul-toggleDot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-border-l3)}
.ul-toggleChip[aria-checked="true"] .ul-toggleDot{background:var(--dsw-alias-label-primary)}

.ul-settingRow{display:flex;flex-direction:column;gap:6px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}
.ul-settingRow:first-of-type{padding-top:0;border-top:0}
.ul-settingHead{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.ul-settingLabel{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.ul-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
.ul-error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:1.5;overflow-wrap:anywhere}
.ul-link{color:var(--dsw-alias-label-secondary);font-size:12px;text-decoration:none}
.ul-link:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}

.ul-formRow{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.ul-input{box-sizing:border-box;font:inherit;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 10px;font-size:12px;line-height:18px;min-width:0}
.ul-input:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:0}
.ul-input--grow{flex:1 1 240px}
.ul-input--num{width:110px;font-variant-numeric:tabular-nums}
.ul-field{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.ul-footer{align-items:center;gap:10px;display:flex;flex-wrap:wrap}

@media (prefers-reduced-motion:reduce){.ul-foot,.ul-footSeg,.ul-barFill,.ul-toggleChip{transition:none}}
`

    function detectLang(localeService) {
      try {
        const cur = localeService && (localeService.current || localeService.language || localeService.locale)
        if (typeof cur === 'string' && cur.toLowerCase().startsWith('ja')) return 'ja'
        if (typeof cur === 'string' && cur.toLowerCase().startsWith('en')) return 'en'
      } catch {
        // Ignore locale service error.
      }
      const docLang = typeof document !== 'undefined' ? document.documentElement?.lang || '' : ''
      const navLang = typeof navigator !== 'undefined' ? navigator.language || '' : ''
      return (docLang || navLang || 'en').toLowerCase().startsWith('ja') ? 'ja' : 'en'
    }

    function makeTranslator(localeService) {
      return function t(key, params) {
        const lang = detectLang(localeService)
        const table = DICT[lang] || DICT.en
        let text = table[key] !== undefined ? table[key] : DICT.en[key] !== undefined ? DICT.en[key] : key
        if (params && typeof params === 'object') {
          for (const [k, v] of Object.entries(params)) {
            text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
          }
        }
        return text
      }
    }

    function useLocaleRevision(localeService) {
      const [, setRev] = useState(0)
      useEffect(() => {
        if (!localeService || typeof localeService.subscribe !== 'function') return undefined
        try {
          return localeService.subscribe(() => setRev((n) => n + 1))
        } catch {
          return undefined
        }
      }, [localeService])
    }

    async function rpc(method, body) {
      const mutating = method !== 'status'
      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), 15000)
      try {
        const res = await fetch(`${ROUTE_PREFIX}/${method}`, {
          method: mutating ? 'POST' : 'GET',
          headers: { 'content-type': 'application/json' },
          body: mutating ? JSON.stringify(body || {}) : undefined,
          signal: controller.signal,
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
        return json
      } finally {
        window.clearTimeout(timer)
      }
    }

    function formatTokens(n) {
      const val = Number(n) || 0
      if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`
      if (val >= 1_000) return `${(val / 1_000).toFixed(1)}k`
      return String(Math.round(val))
    }

    function formatMoney(amount, currency = 'USD') {
      if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—'
      if (currency === 'credits') return `${amount}`
      const symbol = currency === 'EUR' ? '€' : currency === 'JPY' ? '¥' : '$'
      return `${symbol}${amount.toFixed(2)}`
    }

    function formatCountdown(iso) {
      if (!iso) return ''
      const target = Date.parse(iso)
      if (!Number.isFinite(target)) return ''
      const diffSec = Math.max(0, Math.floor((target - Date.now()) / 1000))
      if (diffSec < 60) return '<1m'
      const days = Math.floor(diffSec / 86400)
      const hours = Math.floor((diffSec % 86400) / 3600)
      const mins = Math.floor((diffSec % 3600) / 60)
      if (days > 0) return `${days}d ${hours}h`
      if (hours > 0) return `${hours}h ${mins}m`
      return `${mins}m`
    }

    function formatClock(ms) {
      if (!ms || !Number.isFinite(ms)) return ''
      try {
        return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      } catch {
        return ''
      }
    }

    function formatWindowLabel(win, t, compact = false) {
      if (!win) return ''
      const raw = String(win.label || win.id || '')
      const low = raw.toLowerCase()
      if (low === '5h' || low.includes('5h')) return compact ? t('windowShort_5h') : t('window_5h')
      if (low === 'weekly' || low.includes('week')) return compact ? t('windowShort_weekly') : t('window_weekly')
      if (low === 'monthly' || low.includes('month')) return compact ? t('windowShort_monthly') : t('window_monthly')
      if (compact && low.includes('vibe')) return 'Vibe'
      if (compact && low.includes('api')) return 'API'
      return raw
    }

    function severityFor(remainingPercent, status) {
      if (status === 'rate_limited' || status === 'auth_expired') return 'danger'
      if (remainingPercent !== null && remainingPercent !== undefined) {
        if (remainingPercent <= 10) return 'danger'
        if (remainingPercent <= 25) return 'warn'
      }
      return 'normal'
    }

    function worstPrimaryWindow(provider) {
      const list = Array.isArray(provider?.windows) ? provider.windows : []
      if (list.length === 0) return null
      const primary = list.filter((w) => w.group !== 'partner' && w.remainingPercent !== null && w.remainingPercent !== undefined)
      const pool = primary.length > 0 ? primary : list.filter((w) => w.remainingPercent !== null && w.remainingPercent !== undefined)
      if (pool.length === 0) return list[0]
      return pool.reduce((min, cur) => (cur.remainingPercent < min.remainingPercent ? cur : min), pool[0])
    }

    function sortWindowsPair(list) {
      const rank = (w) => {
        const key = `${w.id || ''} ${w.label || ''}`.toLowerCase()
        if (key.includes('5h')) return 0
        if (key.includes('vibe')) return 1
        if (key.includes('week')) return 2
        if (key.includes('api')) return 3
        if (key.includes('month')) return 4
        return 5
      }
      return [...list].sort((a, b) => rank(a) - rank(b)).slice(0, 2)
    }

    /**
     * Order up to 2 primary windows consistently for the sidebar split bar:
     * short-term (`5h` / `vibe`) on the left, longer-term (`week` / `api`) on the right.
     */
    function selectSidebarWindows(provider) {
      const list = Array.isArray(provider?.windows) ? provider.windows : []
      const primary = list.filter(
        (w) => w.group !== 'partner' && w.group !== 'credit' && w.remainingPercent !== null && w.remainingPercent !== undefined,
      )
      return primary.length <= 1 ? primary : sortWindowsPair(primary)
    }

    function selectPartnerSidebarWindows(provider) {
      const list = Array.isArray(provider?.windows) ? provider.windows : []
      const partner = list.filter(
        (w) => w.group === 'partner' && w.remainingPercent !== null && w.remainingPercent !== undefined,
      )
      return partner.length <= 1 ? partner : sortWindowsPair(partner)
    }

    function displayPercent(win, displayMode) {
      if (!win) return null
      return displayMode === 'used' ? win.usedPercent : win.remainingPercent
    }

    function sourceLabel(source, t) {
      if (source === 'api') return t('sourceApi')
      if (source === 'statusline') return t('sourceStatusline')
      if (source === 'admin-cookie') return t('sourceCookie')
      if (source === 'api+cookie') return t('sourceApiCookie')
      if (source === 'tracker') return t('sourceTracker')
      return ''
    }

    function Ring({ percent, size, severity }) {
      const clamped = Math.max(0, Math.min(100, Number(percent) || 0))
      const circumference = 45.55
      const dashoffset = Math.round(circumference * (1 - clamped / 100) * 1000) / 1000
      const stroke =
        severity === 'danger'
          ? 'var(--dsw-alias-state-error-primary)'
          : severity === 'warn'
            ? 'var(--dsw-alias-state-warn-primary)'
            : 'var(--dsw-alias-label-primary)'
      return h(
        'span',
        { className: 'ul-glyph', 'aria-hidden': 'true' },
        h(
          'svg',
          { viewBox: '0 0 20 20', width: size, height: size, focusable: 'false' },
          h('circle', { cx: 10, cy: 10, r: 7.25, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, opacity: 0.35 }),
          h('circle', {
            cx: 10,
            cy: 10,
            r: 7.25,
            fill: 'none',
            stroke,
            strokeWidth: 2.5,
            strokeLinecap: 'round',
            strokeDasharray: String(circumference),
            strokeDashoffset: String(dashoffset),
            transform: 'rotate(-90 10 10)',
          }),
        ),
      )
    }

    function IconClose() {
      return h(
        'svg',
        { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'm6 6 12 12M18 6 6 18' }),
      )
    }

    class UsageLimitsErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { hasError: false }
      }
      static getDerivedStateFromError() {
        return { hasError: true }
      }
      componentDidCatch(err) {
        try {
          console.warn('[dsh-usage-limits] UI error caught:', err)
        } catch {
          // Ignore console failure.
        }
      }
      render() {
        if (this.state.hasError) return null
        return this.props.children
      }
    }

    function createClientStore() {
      let state = { snapshot: null, loading: true, refreshing: false, error: null }
      const listeners = new Set()
      const emit = () => listeners.forEach((fn) => fn())
      const setState = (patch) => {
        state = { ...state, ...patch }
        emit()
      }

      async function loadStatus() {
        try {
          const snap = await rpc('status')
          setState({ snapshot: snap, loading: false, error: null })
        } catch (err) {
          setState({ loading: false, error: err instanceof Error ? err.message : String(err) })
        }
      }

      async function refresh(providerId) {
        setState({ refreshing: true, error: null })
        try {
          const snap = await rpc('refresh', providerId ? { provider: providerId } : {})
          setState({ snapshot: snap, loading: false, refreshing: false, error: null })
        } catch (err) {
          setState({ refreshing: false, error: err instanceof Error ? err.message : String(err) })
        }
      }

      async function updateConfig(patch) {
        try {
          const snap = await rpc('config', patch)
          setState({ snapshot: snap, error: null })
          return { ok: true, snapshot: snap }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          setState({ error: msg })
          return { ok: false, error: msg }
        }
      }

      async function saveMistralCookie(cookie) {
        try {
          const res = await rpc('mistral-cookie', { cookie })
          if (res?.snapshot) setState({ snapshot: res.snapshot, error: null })
          return res
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      }

      async function manageAgyHook(action, force = false) {
        try {
          const res = await rpc('agy-hook', { action, force })
          if (res?.snapshot) setState({ snapshot: res.snapshot, error: null })
          return res
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      }

      return {
        getState: () => state,
        subscribe(fn) {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
        loadStatus,
        refresh,
        updateConfig,
        saveMistralCookie,
        manageAgyHook,
      }
    }

    function useStore(store) {
      const [snap, setSnap] = useState(() => store.getState())
      useEffect(() => {
        setSnap(store.getState())
        return store.subscribe(() => setSnap(store.getState()))
      }, [store])
      return snap
    }

    function toBarItems(windows, displayMode, t) {
      return windows.map((w) => {
        const rawPct = displayPercent(w, displayMode)
        const clampedPct = rawPct === null || rawPct === undefined ? 0 : Math.max(0, Math.min(100, rawPct))
        const sev = severityFor(w.remainingPercent, w.disabled ? 'rate_limited' : 'ok')
        const label = formatWindowLabel(w, t, true)
        const countdown = w.resetsAt ? formatCountdown(w.resetsAt) : ''
        const tip = [
          `${label} ${Math.round(clampedPct)}%`,
          countdown ? t('resetIn', { left: countdown }) : '',
        ]
          .filter(Boolean)
          .join(' · ')
        return { w, clampedPct, sev, label, tip }
      })
    }

    function renderBarTrack(item, ariaPrefix) {
      return h(
        'span',
        {
          className: 'ul-footBar',
          role: 'progressbar',
          'aria-label': `${ariaPrefix} ${item.label}`,
          'aria-valuemin': 0,
          'aria-valuemax': 100,
          'aria-valuenow': Math.round(item.clampedPct),
          title: item.tip,
        },
        h('span', {
          className: `ul-footSeg ul-footSeg--${item.sev}`,
          style: { width: `${item.clampedPct}%` },
        }),
      )
    }

    function renderSplitOrSingleBar(items, ariaPrefix) {
      if (items.length >= 2) {
        return h(
          'span',
          { className: 'ul-footBarSplit' },
          renderBarTrack(items[0], ariaPrefix),
          h('span', { className: 'ul-footBarDivider', 'aria-hidden': 'true' }),
          renderBarTrack(items[1], ariaPrefix),
        )
      }
      if (items.length === 1) {
        return renderBarTrack(items[0], ariaPrefix)
      }
      return null
    }

    function renderMetricPair(items) {
      return h(
        'span',
        { className: 'ul-footMetrics' },
        items.map((it) =>
          h(
            'span',
            { key: it.w.id, className: 'ul-footMetric' },
            h('span', { className: 'ul-footMetricLabel' }, it.label),
            h(
              'span',
              {
                className: `ul-footPct${it.sev === 'warn' ? ' ul-footPct--warn' : it.sev === 'danger' ? ' ul-footPct--danger' : ''}`,
              },
              `${Math.round(it.clampedPct)}%`,
            ),
          ),
        ),
      )
    }

    function renderDualWindowRow({ key, titleLabel, tooltipLabel, items, errorMessage, openPanel }) {
      const tooltip = errorMessage || [tooltipLabel || titleLabel, ...items.map((it) => it.tip)].filter(Boolean).join(' | ')
      return h(
        'button',
        {
          key,
          type: 'button',
          className: 'ul-foot',
          'aria-label': tooltip,
          title: tooltip,
          onClick: openPanel,
        },
        h(
          'span',
          { className: 'ul-footTop' },
          h('span', { className: 'ul-footName' }, titleLabel),
          h('span', { className: 'ul-spacer' }),
          renderMetricPair(items),
        ),
        renderSplitOrSingleBar(items, titleLabel),
      )
    }

    function SidebarFooterCard({ wide, store, t, localeService, openPanel }) {
      useLocaleRevision(localeService)
      const { snapshot, loading } = useStore(store)

      const config = snapshot?.config
      const displayMode = config?.displayMode || 'remaining'
      const order = snapshot?.order || ['chatgpt', 'claude', 'gemini', 'mistral']
      const providers = snapshot?.providers || {}
      const showPartnerRow = config?.providers?.gemini?.showPartnerRow !== false

      const enabledProviders = useMemo(
        () => order.map((id) => providers[id]).filter((p) => p && p.enabled),
        [order, providers],
      )

      const railSummary = useMemo(() => {
        let minRemaining = null
        let worstSev = 'normal'
        const rank = { normal: 0, warn: 1, danger: 2 }
        for (const p of enabledProviders) {
          const candidates = [worstPrimaryWindow(p)]
          if (p.id === 'gemini' && showPartnerRow) {
            candidates.push(...selectPartnerSidebarWindows(p))
          }
          for (const win of candidates) {
            if (!win) continue
            const sev = severityFor(win.remainingPercent, p.status)
            if (rank[sev] > rank[worstSev]) worstSev = sev
            if (win.remainingPercent !== null && win.remainingPercent !== undefined) {
              minRemaining = minRemaining === null ? win.remainingPercent : Math.min(minRemaining, win.remainingPercent)
            }
          }
        }
        const pct = minRemaining === null ? 0 : displayMode === 'used' ? 100 - minRemaining : minRemaining
        return { pct, severity: worstSev }
      }, [enabledProviders, displayMode, showPartnerRow])

      if (!wide) {
        return h(
          'button',
          {
            type: 'button',
            className: 'ul-railButton',
            'aria-label': t('title'),
            title: t('title'),
            onClick: openPanel,
          },
          h(Ring, { percent: railSummary.pct, size: 18, severity: railSummary.severity }),
        )
      }

      if (loading && !snapshot) {
        return h(
          'div',
          { className: 'ul-footGroup' },
          h(
            'button',
            { type: 'button', className: 'ul-foot', onClick: openPanel },
            h(
              'span',
              { className: 'ul-footTop' },
              h('span', { className: 'ul-footName' }, t('title')),
              h('span', { className: 'ul-spacer' }),
              h('span', { className: 'ul-footSub' }, t('loading')),
            ),
          ),
        )
      }

      if (enabledProviders.length === 0) {
        return h(
          'div',
          { className: 'ul-footGroup' },
          h(
            'button',
            { type: 'button', className: 'ul-foot', onClick: openPanel },
            h(
              'span',
              { className: 'ul-footTop' },
              h('span', { className: 'ul-footName' }, `${t('title')} · ${t('allOff')}`),
            ),
          ),
        )
      }

      const rows = []
      for (const p of enabledProviders) {
        const titleLabel = t(`providerName_${p.id}`)
        const pair = selectSidebarWindows(p)

        if (pair.length >= 2) {
          rows.push(
            renderDualWindowRow({
              key: p.id,
              titleLabel,
              tooltipLabel: titleLabel,
              items: toBarItems(pair, displayMode, t),
              errorMessage: p.error?.message,
              openPanel,
            }),
          )
        } else {
          const win = pair[0] || worstPrimaryWindow(p)
          const sev = severityFor(win?.remainingPercent, p.status)
          const pct = displayPercent(win, displayMode)

          let subText = ''
          let pctText = ''
          let barPct = null

          if (pct !== null && pct !== undefined) {
            barPct = Math.max(0, Math.min(100, pct))
            const label = formatWindowLabel(win, t, true)
            const left = win?.resetsAt ? formatCountdown(win.resetsAt) : ''
            subText = [label, left].filter(Boolean).join(' · ')
            pctText = `${Math.round(pct)}%`
          } else if (p.status === 'loading') {
            subText = t('loading')
          } else if (p.status === 'unconfigured') {
            subText = t('unconfigured')
          } else if (p.status === 'auth_expired') {
            subText = t('authExpired')
          } else if (p.status === 'rate_limited') {
            subText = t('rateLimited')
            barPct = displayMode === 'used' ? 100 : 0
            pctText = displayMode === 'used' ? '100%' : '0%'
          } else if (p.status === 'error') {
            subText = t('error')
          } else if (p.tracker) {
            const tok = p.id === 'mistral' ? p.tracker.thisMonth?.tokens || 0 : p.tracker.last5h?.tokens || 0
            if (p.id === 'gemini' && tok === 0 && !p.meta?.hasLiveCache) {
              subText = t('agyUnsynced')
            } else {
              subText = `${formatTokens(tok)} ${t('tokensUnit')}`
            }
          }

          const tooltip =
            p.error?.message ||
            (p.id === 'gemini' && !p.meta?.hasLiveCache
              ? t('agyHookWaiting')
              : [titleLabel, subText, pctText].filter(Boolean).join(' · '))

          rows.push(
            h(
              'button',
              {
                key: p.id,
                type: 'button',
                className: 'ul-foot',
                'aria-label': tooltip,
                title: tooltip,
                onClick: openPanel,
              },
              h(
                'span',
                { className: 'ul-footTop' },
                h('span', { className: 'ul-footName' }, titleLabel),
                h('span', { className: 'ul-spacer' }),
                subText !== '' ? h('span', { className: 'ul-footSub' }, subText) : null,
                pctText !== ''
                  ? h(
                      'span',
                      { className: `ul-footPct${sev === 'warn' ? ' ul-footPct--warn' : sev === 'danger' ? ' ul-footPct--danger' : ''}` },
                      pctText,
                    )
                  : null,
              ),
              h(
                'span',
                {
                  className: 'ul-footBar',
                  role: 'progressbar',
                  'aria-label': titleLabel,
                  'aria-valuemin': 0,
                  'aria-valuemax': 100,
                  'aria-valuenow': barPct === null ? 0 : Math.round(barPct),
                },
                barPct !== null
                  ? h('span', {
                      className: `ul-footSeg ul-footSeg--${sev}`,
                      style: { width: `${barPct}%` },
                    })
                  : null,
              ),
            ),
          )
        }

        if (p.id === 'gemini' && showPartnerRow) {
          const partnerPair = selectPartnerSidebarWindows(p)
          if (partnerPair.length > 0) {
            rows.push(
              renderDualWindowRow({
                key: 'gemini-partner',
                titleLabel: t('partnerRowName'),
                tooltipLabel: t('partnerFull'),
                items: toBarItems(partnerPair, displayMode, t),
                errorMessage: null,
                openPanel,
              }),
            )
          }
        }
      }

      return h('div', { className: 'ul-footGroup', role: 'region', 'aria-label': t('title') }, rows)
    }

    function Tile({ label, value, sub }) {
      return h(
        'div',
        { className: 'ul-tile' },
        h('span', { className: 'ul-tileLabel' }, label),
        h('span', { className: 'ul-tileValue' }, value),
        sub ? h('span', { className: 'ul-tileSub' }, sub) : null,
      )
    }

    function WindowRow({ win, displayMode, t }) {
      const pct = displayPercent(win, displayMode)
      const sev = severityFor(win.remainingPercent, win.disabled ? 'rate_limited' : 'ok')
      const isPartner = win.group === 'partner'
      const barClass =
        sev === 'danger'
          ? 'ul-footSeg--danger'
          : sev === 'warn'
            ? 'ul-footSeg--warn'
            : isPartner
              ? 'ul-footSeg--secondary'
              : 'ul-footSeg--normal'
      const countdown = win.resetsAt ? formatCountdown(win.resetsAt) : ''
      let amountText = ''
      if (win.used !== null && win.used !== undefined && win.total !== null && win.total !== undefined) {
        amountText =
          win.unit === 'tokens'
            ? `${formatTokens(win.used)} / ${formatTokens(win.total)} tok`
            : `${formatMoney(win.used, win.unit)} / ${formatMoney(win.total, win.unit)}`
      } else if (win.remainingAmount !== null && win.remainingAmount !== undefined) {
        amountText = `${win.remainingAmount} ${win.unit || ''}`.trim()
      }

      return h(
        'div',
        { className: 'ul-window' },
        h(
          'div',
          { className: 'ul-windowHead' },
          h('span', { className: 'ul-windowLabel' }, formatWindowLabel(win, t, false)),
          h('span', { className: 'ul-spacer' }),
          amountText !== '' ? h('span', { className: 'ul-windowValue' }, amountText) : null,
          h(
            'span',
            { className: `ul-windowPct${sev === 'warn' ? ' ul-windowPct--warn' : sev === 'danger' ? ' ul-windowPct--danger' : ''}` },
            pct === null || pct === undefined ? '—' : `${Math.round(pct)}%`,
          ),
        ),
        h(
          'div',
          { className: 'ul-bar' },
          pct !== null && pct !== undefined
            ? h('div', { className: `ul-barFill ${barClass}`, style: { width: `${Math.max(0, Math.min(100, pct))}%` } })
            : null,
        ),
        countdown ? h('p', { className: 'ul-windowReset' }, t('resetIn', { left: countdown })) : null,
      )
    }

    function UsagePanel({ store, t, localeService, onClose, embedded }) {
      useLocaleRevision(localeService)
      const { snapshot, loading, refreshing, error } = useStore(store)
      const [cookieInput, setCookieInput] = useState('')
      const [cookieMsg, setCookieMsg] = useState('')
      const [hookMsg, setHookMsg] = useState('')
      const [intervalDraft, setIntervalDraft] = useState('')
      const [gem5hDraft, setGem5hDraft] = useState('')
      const [gemWkDraft, setGemWkDraft] = useState('')
      const [misMoDraft, setMisMoDraft] = useState('')
      const [settingsMsg, setSettingsMsg] = useState('')

      const config = snapshot?.config
      const providers = snapshot?.providers || {}
      const order = snapshot?.order || ['chatgpt', 'claude', 'gemini', 'mistral']
      const agyHook = snapshot?.agyHook
      const displayMode = config?.displayMode || 'remaining'

      useEffect(() => {
        if (!config) return
        setIntervalDraft(String(config.refreshIntervalSec ?? 180))
        setGem5hDraft(String(config.providers?.gemini?.budget5hTokens ?? 0))
        setGemWkDraft(String(config.providers?.gemini?.budgetWeeklyTokens ?? 0))
        setMisMoDraft(String(config.providers?.mistral?.budgetMonthlyTokens ?? 0))
      }, [
        config?.refreshIntervalSec,
        config?.providers?.gemini?.budget5hTokens,
        config?.providers?.gemini?.budgetWeeklyTokens,
        config?.providers?.mistral?.budgetMonthlyTokens,
      ])

      useEffect(() => {
        if (embedded || !onClose) return undefined
        const onKey = (ev) => {
          if (ev.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [embedded, onClose])

      const toggleProvider = useCallback(
        (id) => {
          const cur = Boolean(config?.providers?.[id]?.enabled)
          void store.updateConfig({ providers: { [id]: { enabled: !cur } } })
        },
        [config, store],
      )

      const togglePartnerRow = useCallback(() => {
        const geminiOn = Boolean(config?.providers?.gemini?.enabled)
        const cur = config?.providers?.gemini?.showPartnerRow !== false
        if (!geminiOn) {
          void store.updateConfig({ providers: { gemini: { enabled: true, showPartnerRow: true } } })
        } else {
          void store.updateConfig({ providers: { gemini: { showPartnerRow: !cur } } })
        }
      }, [config, store])

      const handleSaveDisplay = async () => {
        setSettingsMsg('')
        const res = await store.updateConfig({
          refreshIntervalSec: Number(intervalDraft) || 180,
          providers: {
            gemini: {
              budget5hTokens: Math.max(0, Number(gem5hDraft) || 0),
              budgetWeeklyTokens: Math.max(0, Number(gemWkDraft) || 0),
            },
            mistral: {
              budgetMonthlyTokens: Math.max(0, Number(misMoDraft) || 0),
            },
          },
        })
        if (res.ok) setSettingsMsg(t('saved'))
      }

      const handleSaveCookie = async () => {
        setCookieMsg('')
        const res = await store.saveMistralCookie(cookieInput)
        if (res.ok) {
          setCookieInput('')
          setCookieMsg(t('saved'))
        } else {
          setCookieMsg(res.error || t('error'))
        }
      }

      const handleClearCookie = async () => {
        setCookieMsg('')
        const res = await store.saveMistralCookie('')
        setCookieMsg(res.ok ? t('saved') : res.error || t('error'))
      }

      const handleAgyHook = async (action) => {
        setHookMsg('')
        const res = await store.manageAgyHook(action, false)
        setHookMsg(res.ok ? t('saved') : res.message || res.error || t('error'))
      }

      const enabledOrder = order.filter((id) => Boolean(config?.providers?.[id]?.enabled))
      const lastFetched = Math.max(0, ...order.map((id) => Number(providers[id]?.fetchedAt) || 0))
      const partnerRowOn = Boolean(config?.providers?.gemini?.enabled) && config?.providers?.gemini?.showPartnerRow !== false

      return h(
        'div',
        { className: embedded ? 'ul-main ul-main--embedded' : 'ul-main' },
        h(
          'div',
          { className: 'ul-mainInner' },
          h(
            'header',
            { className: 'ul-header' },
            h(
              'div',
              { className: 'ul-headerText' },
              h('h2', { className: 'ul-title' }, t('title')),
              h('p', { className: 'ul-subtitle' }, t('subtitle')),
            ),
            h('span', { className: 'ul-spacer' }),
            h(
              'button',
              { type: 'button', className: 'ul-btn', disabled: refreshing, onClick: () => void store.refresh() },
              refreshing ? t('refreshing') : t('refresh'),
            ),
            !embedded && onClose
              ? h(
                  'button',
                  { type: 'button', className: 'ul-btn', 'aria-label': t('close'), title: t('close'), onClick: onClose },
                  IconClose(),
                )
              : null,
          ),

          h(
            'section',
            { className: 'ul-card', 'aria-label': t('providersBar') },
            h(
              'div',
              { className: 'ul-cardHead' },
              h('h3', { className: 'ul-cardTitle' }, t('providersBar')),
              h('span', { className: 'ul-spacer' }),
              h(
                'div',
                { className: 'ul-formRow' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: `ul-btn${displayMode === 'remaining' ? ' ul-btn--active' : ''}`,
                    onClick: () => void store.updateConfig({ displayMode: 'remaining' }),
                  },
                  t('modeRemaining'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: `ul-btn${displayMode === 'used' ? ' ul-btn--active' : ''}`,
                    onClick: () => void store.updateConfig({ displayMode: 'used' }),
                  },
                  t('modeUsed'),
                ),
              ),
            ),
            h(
              'div',
              { className: 'ul-toggleBar' },
              order.flatMap((id) => {
                const isOn = Boolean(config?.providers?.[id]?.enabled)
                const chip = h(
                  'button',
                  {
                    key: id,
                    type: 'button',
                    role: 'switch',
                    'aria-checked': isOn ? 'true' : 'false',
                    className: 'ul-toggleChip',
                    onClick: () => toggleProvider(id),
                  },
                  h('span', { className: 'ul-toggleDot', 'aria-hidden': 'true' }),
                  h('span', null, t(`providerName_${id}`)),
                )
                if (id !== 'gemini') return [chip]
                const partnerChip = h(
                  'button',
                  {
                    key: 'gemini-partner',
                    type: 'button',
                    role: 'switch',
                    'aria-checked': partnerRowOn ? 'true' : 'false',
                    className: 'ul-toggleChip',
                    title: t('partnerFull'),
                    onClick: togglePartnerRow,
                  },
                  h('span', { className: 'ul-toggleDot', 'aria-hidden': 'true' }),
                  h('span', null, t('partnerRowName')),
                )
                return [chip, partnerChip]
              }),
            ),
            !config?.providers?.claude?.enabled
              ? h('p', { className: 'ul-hint' }, t('claudeFutureNote'))
              : null,
          ),

          error ? h('p', { className: 'ul-error', role: 'alert' }, error) : null,
          loading && !snapshot ? h('p', { className: 'ul-hint' }, t('loading')) : null,

          enabledOrder.map((id) => {
            const p = providers[id] || { id, enabled: true, status: 'loading', windows: [] }
            const primaryWins = (p.windows || []).filter((w) => w.group !== 'partner' && w.group !== 'credit')
            const partnerWins = (p.windows || []).filter((w) => w.group === 'partner')
            const creditWins = (p.windows || []).filter((w) => w.group === 'credit')
            const worst = worstPrimaryWindow(p)
            const sev = severityFor(worst?.remainingPercent, p.status)
            const badgeText =
              p.status === 'ok'
                ? p.plan || sourceLabel(p.source, t)
                : p.status === 'unconfigured'
                  ? t('unconfigured')
                  : p.status === 'auth_expired'
                    ? t('authExpired')
                    : p.status === 'rate_limited'
                      ? t('rateLimited')
                      : p.status === 'loading'
                        ? t('loading')
                        : t('error')

            const tiles = []
            if (p.credits) tiles.push({ key: 'credits', label: t('credits'), value: formatMoney(p.credits.balance, p.credits.currency) })
            if (p.spend) tiles.push({ key: 'spend', label: t('monthSpend'), value: formatMoney(p.spend.amount, p.spend.currency) })
            if (p.tracker) {
              if (id === 'gemini') {
                tiles.push({
                  key: 't5h',
                  label: t('dshUsage5h'),
                  value: `${formatTokens(p.tracker.last5h?.tokens || 0)} ${t('tokensUnit')}`,
                  sub: `${p.tracker.last5h?.requests || 0} ${t('requestsUnit')}`,
                })
                tiles.push({
                  key: 't7d',
                  label: t('dshUsage7d'),
                  value: `${formatTokens(p.tracker.last7d?.tokens || 0)} ${t('tokensUnit')}`,
                  sub: `${p.tracker.last7d?.requests || 0} ${t('requestsUnit')}`,
                })
              } else if (id === 'mistral') {
                tiles.push({
                  key: 'ttoday',
                  label: t('dshUsageToday'),
                  value: `${formatTokens(p.tracker.today?.tokens || 0)} ${t('tokensUnit')}`,
                  sub: `${p.tracker.today?.requests || 0} ${t('requestsUnit')}`,
                })
                tiles.push({
                  key: 'tmonth',
                  label: t('dshUsageMonth'),
                  value: `${formatTokens(p.tracker.thisMonth?.tokens || 0)} ${t('tokensUnit')}`,
                  sub: `${p.tracker.thisMonth?.requests || 0} ${t('requestsUnit')}`,
                })
              }
            }

            return h(
              'section',
              { key: id, className: 'ul-card', 'aria-label': t(`providerName_${id}`) },
              h(
                'div',
                { className: 'ul-cardHead' },
                h('h3', { className: 'ul-cardTitle' }, t(`providerName_${id}`)),
                badgeText
                  ? h(
                      'span',
                      { className: `ul-badge${sev === 'warn' ? ' ul-badge--warn' : sev === 'danger' ? ' ul-badge--danger' : ''}` },
                      badgeText,
                    )
                  : null,
                p.stale ? h('span', { className: 'ul-badge ul-badge--warn' }, t('stale')) : null,
                h('span', { className: 'ul-spacer' }),
                p.source && p.source !== 'none' ? h('span', { className: 'ul-meta' }, sourceLabel(p.source, t)) : null,
                p.meta?.dashboardUrl
                  ? h('a', { className: 'ul-link', href: p.meta.dashboardUrl, target: '_blank', rel: 'noreferrer' }, t('openDashboard'))
                  : null,
              ),

              primaryWins.length > 0
                ? h('div', { className: 'ul-windows' }, primaryWins.map((win) => h(WindowRow, { key: win.id, win, displayMode, t })))
                : null,

              partnerWins.length > 0
                ? h(
                    React.Fragment,
                    null,
                    h('p', { className: 'ul-blockTitle' }, t('partnerGroup')),
                    h('div', { className: 'ul-windows' }, partnerWins.map((win) => h(WindowRow, { key: win.id, win, displayMode, t }))),
                  )
                : null,

              creditWins.length > 0
                ? h(
                    React.Fragment,
                    null,
                    h('p', { className: 'ul-blockTitle' }, t('creditGroup')),
                    h('div', { className: 'ul-windows' }, creditWins.map((win) => h(WindowRow, { key: win.id, win, displayMode, t }))),
                  )
                : null,

              tiles.length > 0
                ? h('div', { className: 'ul-tiles' }, tiles.map((tile) => h(Tile, tile)))
                : null,

              id === 'gemini' && !p.meta?.hasLiveCache
                ? h('p', { className: 'ul-hint' }, t('agyHookWaiting'))
                : null,

              primaryWins.length === 0 && partnerWins.length === 0 && tiles.length === 0 && !p.error?.message
                ? h('p', { className: 'ul-hint' }, t('noWindows'))
                : null,

              p.error?.message
                ? h('p', { className: p.status === 'unconfigured' ? 'ul-hint' : 'ul-error' }, p.error.message)
                : null,
            )
          }),

          config
            ? h(
                'section',
                { className: 'ul-card', 'aria-label': t('settingsTitle') },
                h('h3', { className: 'ul-cardTitle' }, t('settingsTitle')),

                h(
                  'div',
                  { className: 'ul-settingRow' },
                  h(
                    'div',
                    { className: 'ul-settingHead' },
                    h('span', { className: 'ul-settingLabel' }, t('agyHookTitle')),
                    agyHook?.installed
                      ? h('button', { type: 'button', className: 'ul-btn ul-btn--danger', onClick: () => void handleAgyHook('uninstall') }, t('agyHookUninstall'))
                      : h('button', { type: 'button', className: 'ul-btn', onClick: () => void handleAgyHook('install') }, t('agyHookInstall')),
                  ),
                  h(
                    'p',
                    { className: 'ul-hint' },
                    agyHook?.installed
                      ? providers.gemini?.meta?.hasLiveCache
                        ? t('agyHookInstalled')
                        : `${t('agyHookInstalled')} · ${t('agyHookWaiting')}`
                      : agyHook?.customStatusLinePresent
                        ? t('agyHookCustomConflict')
                        : t('agyHookNotInstalled'),
                  ),
                  hookMsg ? h('p', { className: 'ul-hint' }, hookMsg) : null,
                ),

                h(
                  'div',
                  { className: 'ul-settingRow' },
                  h(
                    'div',
                    { className: 'ul-settingHead' },
                    h('span', { className: 'ul-settingLabel' }, t('mistralCookieTitle')),
                    h(
                      'span',
                      { className: `ul-badge${providers.mistral?.meta?.cookieConfigured ? ' ul-badge--ok' : ''}` },
                      providers.mistral?.meta?.cookieConfigured ? t('mistralCookieConfigured') : t('mistralCookieMissing'),
                    ),
                  ),
                  h('p', { className: 'ul-hint' }, t('mistralCookieHint')),
                  h(
                    'div',
                    { className: 'ul-formRow' },
                    h('input', {
                      type: 'password',
                      className: 'ul-input ul-input--grow',
                      value: cookieInput,
                      placeholder: t('mistralCookiePlaceholder'),
                      onChange: (ev) => setCookieInput(ev.target.value),
                      autoComplete: 'off',
                    }),
                    h(
                      'button',
                      { type: 'button', className: 'ul-btn', disabled: !cookieInput.trim(), onClick: () => void handleSaveCookie() },
                      t('mistralCookieSave'),
                    ),
                    providers.mistral?.meta?.cookieConfigured
                      ? h('button', { type: 'button', className: 'ul-btn ul-btn--danger', onClick: () => void handleClearCookie() }, t('mistralCookieClear'))
                      : null,
                  ),
                  cookieMsg ? h('p', { className: 'ul-hint' }, cookieMsg) : null,
                ),

                h(
                  'div',
                  { className: 'ul-settingRow' },
                  h('span', { className: 'ul-settingLabel' }, t('refreshInterval')),
                  h('p', { className: 'ul-hint' }, t('budgetHint')),
                  h(
                    'div',
                    { className: 'ul-formRow' },
                    h(
                      'label',
                      { className: 'ul-field' },
                      h('span', null, t('refreshInterval')),
                      h('input', {
                        type: 'number',
                        min: 60,
                        max: 900,
                        className: 'ul-input ul-input--num',
                        value: intervalDraft,
                        onChange: (ev) => setIntervalDraft(ev.target.value),
                      }),
                    ),
                    h(
                      'label',
                      { className: 'ul-field' },
                      h('span', null, t('budget5h')),
                      h('input', {
                        type: 'number',
                        min: 0,
                        step: 100000,
                        className: 'ul-input ul-input--num',
                        value: gem5hDraft,
                        onChange: (ev) => setGem5hDraft(ev.target.value),
                      }),
                    ),
                    h(
                      'label',
                      { className: 'ul-field' },
                      h('span', null, t('budgetWeekly')),
                      h('input', {
                        type: 'number',
                        min: 0,
                        step: 500000,
                        className: 'ul-input ul-input--num',
                        value: gemWkDraft,
                        onChange: (ev) => setGemWkDraft(ev.target.value),
                      }),
                    ),
                    h(
                      'label',
                      { className: 'ul-field' },
                      h('span', null, t('budgetMonthly')),
                      h('input', {
                        type: 'number',
                        min: 0,
                        step: 500000,
                        className: 'ul-input ul-input--num',
                        value: misMoDraft,
                        onChange: (ev) => setMisMoDraft(ev.target.value),
                      }),
                    ),
                    h('button', { type: 'button', className: 'ul-btn', onClick: () => void handleSaveDisplay() }, t('save')),
                  ),
                  settingsMsg ? h('p', { className: 'ul-hint' }, settingsMsg) : null,
                ),
              )
            : null,

          h(
            'footer',
            { className: 'ul-footer' },
            h('span', { className: 'ul-meta' }, lastFetched > 0 ? t('updated', { time: formatClock(lastFetched) }) : ''),
            h('span', { className: 'ul-spacer' }),
            h(
              'button',
              { type: 'button', className: 'ul-btn', disabled: refreshing, onClick: () => void store.refresh() },
              refreshing ? t('refreshing') : t('refresh'),
            ),
          ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        let localeService = null
        try {
          localeService = ctx.get('locale')
        } catch {
          localeService = null
        }

        const t = makeTranslator(localeService)
        const store = createClientStore()

        ctx.effect(() => {
          if (typeof document === 'undefined') return undefined
          let tag = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)
          if (!tag) {
            tag = document.createElement('style')
            tag.dataset.plugin = PLUGIN_ID
            tag.dataset.pluginCss = STYLE_ID
            tag.textContent = CSS
            document.head.appendChild(tag)
          }
          return () => {
            if (tag && tag.parentNode) tag.parentNode.removeChild(tag)
          }
        }, 'dsh-usage-limits: styles')

        ctx.effect(() => {
          void store.loadStatus()
          let lastFetch = Date.now()
          const tick = () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
            const intervalMs = ((store.getState().snapshot?.config?.refreshIntervalSec) || 180) * 1000
            if (Date.now() - lastFetch >= intervalMs) {
              lastFetch = Date.now()
              void store.loadStatus()
            }
          }
          const timer = window.setInterval(tick, 15000)
          const onVis = () => {
            if (document.visibilityState === 'visible') tick()
          }
          document.addEventListener('visibilitychange', onVis)
          return () => {
            window.clearInterval(timer)
            document.removeEventListener('visibilitychange', onVis)
          }
        }, 'dsh-usage-limits: polling')

        const openPanel = () => {
          try {
            const layout = ctx.get('layout')
            if (layout && typeof layout.selectPanel === 'function') {
              layout.selectPanel(PANEL_ID)
            }
          } catch (err) {
            console.warn('[dsh-usage-limits] failed to open panel:', err)
          }
        }

        const closePanel = () => {
          try {
            const layout = ctx.get('layout')
            if (layout && typeof layout.selectPanel === 'function') {
              layout.selectPanel(null)
            }
          } catch {
            // Ignore layout absence.
          }
        }

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            { name: 'main', key: PANEL_ID },
            () =>
              h(
                UsageLimitsErrorBoundary,
                null,
                h(UsagePanel, { store, t, localeService, onClose: closePanel, embedded: false }),
              ),
          ),
        )

        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            { name: 'sidebar.footer.action', id: PANEL_ID, order: 10 },
            (props) =>
              h(
                UsageLimitsErrorBoundary,
                null,
                h(SidebarFooterCard, { wide: Boolean(props?.wide), store, t, localeService, openPanel }),
              ),
          ),
        )

        ctx.slots.inject('plugins.bundle.config', () =>
          ctx.slots.register(
            {
              name: 'plugins.bundle.config',
              key: PLUGIN_ID,
              label: () => t('title'),
            },
            (props) => {
              if (props && props.view === 'summary') {
                return h('span', null, t('summary'))
              }
              return h(
                UsageLimitsErrorBoundary,
                null,
                h(UsagePanel, { store, t, localeService, onClose: null, embedded: true }),
              )
            },
          ),
        )
      },
    }
  },
})
