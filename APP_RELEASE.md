# App Store / Google Play リリースガイド

**現在地: 申請の直前まで完成。** ここから先(アカウント作成・実機署名・実際の提出)は
社長の作業です。このファイルはそのための手順書です。

---

## 今できていること(検証済み)

- Capacitorでネイティブアプリ化(`com.hyuga0403kagawa.hiraganamahjong`)
- **Androidはデバッグビルドが実際に成功**(`android/app/build/outputs/apk/debug/app-debug.apk`、4.4MB)。
  manifest検証済み(パッケージ名・INTERNET権限・targetSdk36)
- ネイティブ判定ロジック(本番サーバーへの接続・CORS)をローカルで実機相当の条件で検証済み:
  オンライン検出 → ランク戦マッチング → 実対局進行まで一気通貫で成功
- アイコン・スプラッシュ画面一式を全密度(Android)・1024px(iOS)で生成済み。2026-09-24にデザインを刷新
  (アイコン=「ひ」の牌1枚、社長が4案からB案を選択。ロゴ=「ひらがな」の牌4枚+「麻雀」)。
  ロゴ・ストア用画像は `brand/`。作り直すときは `node tools/gen_icons.mjs` と `node tools/gen_native_icons.mjs`
  (Edgeと Noto Serif JP フォントを使う。文字はOFLライセンスのフォントなので商用利用可)
- 「デモ決済」UI(コイン購入・広告なし購入)はネイティブ版でのみ非表示化(実装と打ち出しの一致)
- **デモ広告もネイティブ版では一切出さない**(起動時・対局後・「広告でコインGET」・ショップの広告行・ヘルプの広告説明。2026-09-23 社長決定)。Web版は従来どおり
- プライバシーポリシー公開済み: **https://hiragana-mahjong.onrender.com/privacy.html**
- 全テスト158件合格・ゲーム本体のバグなし

## ここから先(社長の作業)

### 共通で必要なもの
| もの | 費用 | 誰が作るか |
|---|---|---|
| Googleアカウント → Google Play Console登録 | $25(初回のみ) | 社長 |
| Apple ID → Apple Developer Program登録 | $99/年 | 社長 |

---

## Android(Mac不要・こちらのPCで完結)

### 1. 署名鍵(キーストア)を作る
Play Storeにアップロードするには、自分専用の署名鍵で「リリース版」をビルドする必要がある。
これはアカウント登録より先に、このPC上で作れる。

```powershell
cd "C:\Users\jiany\OneDrive\Desktop\AI作業場\hiragana-mahjong"
$env:JAVA_HOME = "$pwd\native-tools\jdk-21.0.5+11"
& "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -v -keystore hiragana-mahjong-release.keystore `
  -alias hiragana-mahjong -keyalg RSA -keysize 2048 -validity 10000
```
- パスワードを聞かれるので決めて控えておく(**この鍵とパスワードを紛失すると、
  同じアプリを二度とアップデートできなくなる**。安全な場所に保管すること)
- 生成された `hiragana-mahjong-release.keystore` は `.gitignore` 済み(リポジトリには入れない)

### 2. リリース版AAB(Play Store提出用)をビルド
```powershell
cd "C:\Users\jiany\OneDrive\Desktop\AI作業場\hiragana-mahjong"
$env:JAVA_HOME = "$pwd\native-tools\jdk-21.0.5+11"
$env:ANDROID_HOME = "$pwd\native-tools\android-sdk"
node tools/build_www.mjs
npx cap sync android
cd android
.\gradlew.bat --init-script ..\tools\gradle-build-outside-onedrive.gradle bundleRelease `
  -Pandroid.injected.signing.store.file="..\hiragana-mahjong-release.keystore" `
  -Pandroid.injected.signing.store.password="(さっき決めたパスワード)" `
  -Pandroid.injected.signing.key.alias="hiragana-mahjong" `
  -Pandroid.injected.signing.key.password="(さっき決めたパスワード)"
```
成功すると **`C:\hm-build\app\outputs\bundle\release\app-release.aab`** ができる。これをPlay Consoleにアップロードする。
- `--init-script ...` はビルドの出力先をOneDriveの外(`C:\hm-build`)に向ける指定。OneDriveの中でビルドすると
  「not a regular file」「Unable to delete directory」で失敗するため必須(2026-09-24 確認)
- `node tools/build_www.mjs` が EPERM で止まったら、下の「既知の制約」3 の方法で `www/` を上書きしてから続ける

### 3. Play Consoleでの出品
1. https://play.google.com/console でアプリを新規作成(名前: ひらがな麻雀)
2. ストアの掲載情報を入力(下の「ストア掲載文言」を参照)
3. アプリのアイコンは `android/play-store-icon-512.png`(512×512、ストア掲載専用。アプリ本体には同梱されない)
   フィーチャーグラフィック(必須・1024×500)は `brand/play-feature-graphic-1024x500.png`
4. プライバシーポリシーURL: `https://hiragana-mahjong.onrender.com/privacy.html`
5. データセーフティ フォーム: 下の「データセーフティの回答」を参照
6. コンテンツのレーティング questionnaire: 下の「年齢レーティング」を参照
7. 「製品版」または「クローズドテスト」トラックに `app-release.aab` をアップロード
8. 審査に提出(Googleは通常1〜数日)

---

## iOS(Mac + Xcode が必須)

Windowsではビルド・署名・提出のいずれもできない。自分のMac、または
Codemagic / GitHub Actions(macOSランナー)等のクラウドMacビルドサービスが必要。

### 1. コードをMac(またはクラウドMac環境)に用意
```bash
git clone https://github.com/hyuga0403kagawa-rgb/hiragana-mahjong.git
cd hiragana-mahjong
npm install
node tools/build_www.mjs
npx cap sync ios
```

### 2. Xcodeで開いて署名・アーカイブ
```bash
npx cap open ios
```
Xcodeが開いたら:
1. 左のプロジェクトナビゲータで「App」ターゲットを選択
2. 「Signing & Capabilities」タブで、Apple Developer Programのチームを選択(Xcodeが自動でプロビジョニングを作る)
3. メニューの Product → Archive でビルド
4. Organizerウィンドウが開くので「Distribute App」→「App Store Connect」→ アップロード

### 3. App Store Connectでの出品
1. https://appstoreconnect.apple.com で新規Appを作成(Bundle ID: `com.hyuga0403kagawa.hiraganamahjong`)
2. ストアの掲載情報を入力(下の「ストア掲載文言」を参照)
3. プライバシーポリシーURL: `https://hiragana-mahjong.onrender.com/privacy.html`
4. App Privacy(データ収集の申告): 下の「データセーフティの回答」を参照(内容はGoogleと同じ)
5. 年齢制限(Age Rating): 下の「年齢レーティング」を参照
6. Xcodeからアップロードしたビルドを選択して審査に提出(Appleは通常1〜3日)

---

## ストア掲載文言(コピペ用)

**アプリ名**: ひらがな麻雀

**短い説明(Google Play用、80字以内)**:
> ひらがなの牌でことばを作って上がる新感覚麻雀。ランク戦・友達対戦・ひとり練習つき。

**詳しい説明**:
> 「ひらがな麻雀」は、麻雀のルールでひらがなの牌を並べ、ことばを完成させてあがる言葉あそびゲームです。
>
> ■ あそびかた
> 手牌を「2文字のことば×1つ + 3文字のことば×4つ」の順番に並べると、あがりになります。
> どんなことばができるかは自分で見つける必要があり、辞書には16,000語以上を収録しています。
>
> ■ あそべるモード
> ・ひとり練習: 相手も時間制限もなし。ならべ方をじっくり覚えられます
> ・フリー対戦: CPUと気軽に対戦。つよさは3段階から選べます
> ・ランク戦: オンラインで真剣勝負。G〜Sの8ランク
> ・ともだち対戦: ルームコードでオンライン対戦
>
> ■ やりこみ要素
> ・ことば図鑑: 対局で作ったことばを集める
> ・実績・称号: 20種類の達成目標
> ・牌や卓の着せかえ、BGM・効果音の変更

**キーワード**: 麻雀,ひらがな,言葉,パズル,ワードゲーム,脳トレ,対戦,ランク戦

**カテゴリ**: ゲーム > パズル または ボード

---

## 年齢レーティング

- 実際の金銭を賭ける要素、real-money gambling は一切なし
- 「麻雀」がテーマだが、ルールは独自の言葉あそびで、点数のやり取りもゲーム内通貨のみ
- 暴力・性的表現・不適切な言語は一切なし
- Google Play: 「みんな」/ Apple: **4+** を想定
- 麻雀という単語自体に反応する審査ガイドの項目があれば(「シミュレートされたギャンブル」等)、
  「実際の金銭を賭ける要素はなく、役・点数計算もない言葉あそびゲームである」ことを申請時のメモ欄で補足する

## データセーフティ/App Privacyの回答

`privacy.html` の内容と完全に一致させること。要点:
- **収集する個人情報: なし**(氏名・メール・電話番号・住所等は一切収集しない)
- ニックネーム(自由入力・実名不要)とアイコン選択のみ、オンライン対戦時にサーバーへ送信
- サーバー側での永続保存なし(対局終了時にメモリから消去)
- 位置情報・連絡先・写真等へのアクセスなし
- 広告SDK・解析SDK・クラッシュレポートSDK: **組み込みなし**
- 第三者への data sharing: **なし**
- アプリ内課金: **現状なし**(ストア版では購入UIを非表示にしてある)
- Play Consoleの「広告を含むか」: **いいえ**(ストア版は広告を一切表示しない)

---

## 方針(2026-09-23 社長決定)

| 項目 | 方針 |
|---|---|
| iOS | **後回し。** まずAndroidだけ出す。iOSはダウンロード数を見て再判断 |
| 広告 | **ストア版では出さない**(実装済み)。実広告SDK(AdMob等)は入れない |
| 課金 | **いまは入れない。** 将来入れる前提の設計だけ下に残す |
| サーバー | **Render無料枠のまま。** 審査に出す直前に社長が本番URLを開いて起こしておく |

## 既知の制約(社長への申し送り)

1. **iOSは実機ビルド未確認。** Xcodeでの署名・実機動作確認はMacでの作業が必要。
   コード側(www/資産・Capacitor設定・アイコン)は用意済みだが、実際にビルドが通るかはXcode環境依存。
2. **Renderの無料枠はスリープする。** 起動直後のオンライン対戦は数十秒待つことがある。
   審査提出の直前に https://hiragana-mahjong.onrender.com を開いて起こしておく。
3. **`tools/build_www.mjs` がOneDrive上で `www/` の削除に失敗することがある(EPERM)。**
   その場合は `index.html manifest.webmanifest css src icons` を `www/` へ上書きコピーしてから `npx cap sync`。

## 課金を将来入れるときの設計(未実装・設計のみ)

いまはコードに手を入れない。入れると決めたときの前提と順番だけ残す。

**売るもの(最初は1種類に絞る)**
- コインパック(消耗型)。既存の `COIN_PACKS`(`src/economy.js`)をストアの商品IDに対応させる
- 「広告なし」(非消耗型)は**ストア版では売らない**。ストア版はもともと広告を出さないので売る意味がない

**つなぎ方**
- 購入処理は `src/billing.js` のような1ファイルに閉じ込め、「ストアで購入確定 → 既存の `buyCoinPack()` でコイン付与」
  の順にする。ゲーム本体・経済ロジック(`economy.js`)は変えない
- Web版は今のデモ決済のまま。ネイティブ版だけ `billing.js` を通す(`IS_NATIVE` で分岐、今の非表示と同じ場所)
- Capacitor用の課金プラグインを使う(候補の選定は実装時に行う。現時点で未調査)

**先に決める・確認すること(実装より前)**
1. セーブが端末内だけ(`localStorage`)なので、**アプリを消すと買ったコインも消える。**
   これを許すか、アカウント/サーバー保存を作るか。許すならストアの説明文に明記する
2. 購入の正当性チェック(レシート検証)をサーバーでやるか。いまのサーバーは保存を持たない設計
3. 有料コインは法律上の扱い(前払式支払手段など)が関わる可能性がある → **専門家/公式情報で要確認**(AIの一般知識であり未検証)
4. 特商法の表記、プライバシーポリシー(`privacy.html`)の「お支払いについて」の書き換え
5. テストには有料デベロッパーアカウントとサンドボックス(テスト購入)環境が必要
