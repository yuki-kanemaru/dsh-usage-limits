# dsh-usage-limits

[English README](./README.md)

DeepSeek Harness（DSH）Web GUIの左サイドバー下部（Settingsの直上）に、ChatGPT、Claude、Gemini（Antigravity）、Claude (AGY)、Mistralの利用上限をまとめて表示するプラグインです。

## 主な機能

- 左サイドバー下部ウィジェット（`sidebar.footer.action`）: 展開時は有効なプロバイダーの残量または使用率とプログレスバーを表示し、折りたたみ時は各プロバイダーの2分割アーク円形ゲージ（`GPT` / `Gem` / `AGY` / `Mis` 等）を1行に並べて表示します。56pxの折りたたみレール時は状態色付きのSVGリングアイコンを表示します。PC版・スマホ版ともに折りたたみ／展開トグルに対応し、スマホ等の狭幅・低画面（幅768px未満または高さ640px以下）ではセッション一覧を圧迫しないよう初期状態でコンパクト表示になります（展開時も高さ上限付きでスクロール可能）。
- 中央分割の2枠プログレスバー: 2つの利用枠を持つプロバイダーは中央で区切ったバーを表示し、左側に短期枠（`5h`または`Vibe`）、右側に長期枠または別枠（`week`または`API`）を並べます。各バーにカーソルを合わせるとリセットまでの残り時間を確認できます。
- 独立した`Claude (AGY)`行: Antigravityのパートナーモデル枠（`3p-5h`、`3p-weekly`）をGemini本体枠（`gemini-5h`、`gemini-weekly`）から分離し、個別にONとOFFを切り替えられる独立行としてサイドバーに表示します。
- プロバイダーごとのON・OFF切替: ChatGPT、Claude、Gemini、`Claude (AGY)`、Mistral、PC ステータスの表示を詳細パネルから個別に切り替えられます（初期状態ではClaudeのみOFFです）。
- PC 状況＆電気代モニター: CPU・メモリ・NVIDIA GPU（使用率／VRAM／温度／実測 W）・OS 起動経過時間・推定消費電力（W）・myTOKYOGAS（東京ガス「基本プラン」2026年12月改定基準）による起動中／本日／今月の推定電気代（円）を表示します。段階単価・再エネ賦課金・燃料費調整額・ガス電気セット割・基礎電力は詳細パネルから調整可能です。
- 詳細・設定パネル（`main`および`plugins.bundle.config`）: 各枠のリセットカウントダウン、AntigravityのGemini枠とパートナー枠、MistralのVibeおよびAPI予算とクレジット残高、DSHローカル集計、Antigravity公式`statusLine`フック設定、任意のMistral管理画面Cookie設定を確認および変更できます。

## 各プロバイダーの取得ソース

| プロバイダー | 取得ソース | 補足 |
| --- | --- | --- |
| ChatGPT | `~/.codex/auth.json`（読み取り専用）→ `chatgpt.com/backend-api/wham/usage` | `dsh-chatgpt-sub`側のトークン更新と競合しないよう、読み取り専用で参照します。 |
| Claude | `CLAUDE_CODE_OAUTH_TOKEN`または`~/.claude/.credentials.json`（読み取り専用）→ `api.anthropic.com/api/oauth/usage` | 初期状態はOFFです。`claude login`後に詳細パネルからONにすると連携します。 |
| Gemini・Claude (AGY) | Antigravity CLI公式`statusLine`フック（`~/.dsh/dsh-usage-limits/agy-quota-cache.json`）およびDSHローカル集計 | 非公式エンドポイントへの直接アクセスは行いません。詳細パネルの有効化ボタンから`~/.gemini/antigravity-cli/settings.json`へ安全に設定でき、既存の`statusLine`がある場合は上書きしません。 |
| Mistral | 1. `MISTRAL_API_KEY` → `/v1/billing/subscription`, `/v1/billing/budget`<br>2. 任意の`MISTRAL_ADMIN_COOKIE`（`admin.mistral.ai`）→ `/subscription`, `/api/billing/v2/usage`, `/api/billing/credits` | 有効な予算がある場合は未割り当ての`$0`予算を除外します。CookieはDSH認証情報ストアに保存し、ブラウザへは返却しません。 |

## インストール方法

### DSH Desktopの画面から追加する

1. DSHの Settings → Plugins → Add plugin を開きます。
2. GitHubリポジトリのURLを入力して追加します。
   ```text
   https://github.com/yuki-kanemaru/dsh-usage-limits
   ```
3. `dsh-usage-limits`を有効にしたあと、DSHを再起動します（Host側のHTTPルート読み込みに再起動が必要です）。

### CLIから追加する

```bash
dsh plugin --profile desktop add https://github.com/yuki-kanemaru/dsh-usage-limits
```

追加後はDSHを再起動してください。

## Antigravity（`agy`）の残量同期

1. DSHで利用上限の詳細パネルを開き、Antigravity `statusLine`フックの有効化ボタンを押します。
2. ターミナルで`agy`を一度起動して3〜5秒ほど待ち、`/exit`で終了します。
3. フックが`gemini-5h`、`gemini-weekly`、`3p-5h`、`3p-weekly`の残量だけを`~/.dsh/dsh-usage-limits/agy-quota-cache.json`へ保存し、DSH側へ反映されます。

## テストと構文チェック

```bash
npm run check
npm test
```

## セキュリティとプライバシー

- APIキー、OAuthトークン、任意のMistral Admin CookieはすべてDSHのHostプロセス内でのみ読み取り専用に使用し、ブラウザやログへ出力しません。
- Antigravity `statusLine`フックがキャッシュへ書き出す項目は残量割合、リセット時刻、プラン名、モデル表示名に限られ、トークンやメールアドレスは保存しません。
- 設定は`~/.dsh/dsh-usage-limits/config.json`に保存され、認証情報は含みません。

## ライセンス

[MIT](./LICENSE)
