# 公開・運用ガイド

**現在の本番: https://hiragana-mahjong.onrender.com (モードB・2026-08-20デプロイ済み)**
リポジトリ: https://github.com/hyuga0403kagawa-rgb/hiragana-mahjong (mainへのpushで自動デプロイ)

公開方法は**用途ごとに3モード**ある。期待値が違うので混ぜないこと。

| モード | URL | 稼働 | オンライン対戦 | 用途 |
|---|---|---|---|---|
| **A. お試し公開** | 毎回変わる | PC起動中のみ | 動く (低遅延) | 友達にその場で共有 |
| **B. 常設(開発版)** | 固定 | 無料枠・スリープあり | 動くが初回接続が遅い | 動作確認・デモ |
| **C. 本番** | 固定 | 常時起動 | 安定 | 本気で運用するなら |

---

## A. お試し公開 (Cloudflare Quick Tunnel)

`オンライン公開.bat` をダブルクリックするだけ。アカウント不要。

- 公開URLが表示され、クリップボードにコピーされる (`tools/public-url.txt` にも保存)
- **PCがスリープ・再起動すると止まる。URLは起動のたびに変わる**
- ランク戦・ともだち対戦とも問題なく動く (遅延は自宅回線に依存)

止めるときは `cloudflared.exe` と `node` のプロセスを終了する。

---

## B. 常設 (Render 無料枠)

固定URLで24時間アクセスできるが、**15分アクセスがないとスリープ**し、
次のアクセスで起動に数十秒かかる。**ランク戦のマッチングは体験が悪化する**ので、
図鑑・フリー対戦のデモや、ともだち対戦の約束対戦向け。

### 手順
1. GitHubアカウントを作り、このフォルダをリポジトリとしてアップロードする
   - 除外してよい: `node_modules/`、`dist/`、`tools/cloudflared.exe`、`tools/tunnel.log`、`tools/public-url.txt`
2. https://render.com にGitHubアカウントでサインアップ
3. New → Web Service → 上記リポジトリを選択
4. 設定は下記のとおり (自動検出されるが必ず確認する)

| 項目 | 値 |
|---|---|
| Runtime | Node |
| Build Command | `npm install` |
| **Start Command** | **`npm start`** |
| 環境変数 | `HJ_DEBUG=0` (ログを静かにする場合) |

> **Start Command は `npm start` の1つだけが正。**
> `tools/gameserver.mjs` は `PORT` 環境変数を読むので、Renderが割り当てるポートで自動的に待ち受ける。
> `node tools/gameserver.mjs $PORT` のように書く必要はない (書いても動くが二重管理になる)。

5. デプロイ完了後、[README.md](README.md) の「リリース前チェック」を実施する

---

## C. 本番運用にするなら

無料枠のままランク戦を主軸にするのは勧めない。最低限これを満たすこと。

- **常時起動**のプラン (スリープなし)。Render有料 / Fly.io / VPS など
- WebSocketの接続維持 (アイドルタイムアウトが短いプロキシを挟まない)
- プロセス監視と自動再起動 (systemd / PM2 / プラットフォームの再起動機能)
- ログの保存 (`HJ_DEBUG=1` の進行ログは調査に使える。個人情報は含まない)
- 追加で実装が必要な項目 ([docs/SERVER_SPEC.md](docs/SERVER_SPEC.md) の「既知の制約」):
  - 再接続対応 (現状は切断すると席がCPUに渡り戻れない)
  - ランクRPのサーバ管理 (現状クライアント保存のため改ざん可能)
  - `join` 試行のレート制限 (ルームコードの総当たり対策)

## 代替ホスティング
Railway / Koyeb / Fly.io でも同じ手順で動く (Node + WebSocket + `PORT` 環境変数)。
**静的ホスティング (GitHub Pages, Netlify, Vercelの静的配信) は不可** — WebSocketサーバが必要なため。
静的に置く場合はフリー対戦・図鑑・実績のみ動作する。
