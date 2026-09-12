【v0.3.2 修正内容】
・人物を小さくしたときにマウスで掴みにくくなる問題を修正。
・縦長画像などでCanvas表示が縮小された際の座標ずれを修正。
・人物の周囲に画面上約18pxの掴みやすい判定余裕を追加。
・v0.3.1の輪郭補正と人物不透明度修正は維持。

【v0.3.1 修正内容】
人物全体が半透明になる不具合を修正しました。
切り抜き方式をv0.2で安定していたCanvas合成方式に戻し、
その後で輪郭だけを補正します。

あとから自撮り v0.3.1

【今回の追加】
1. 輪郭補正
   人物マスクを少し内側へ縮め、低信頼の半透明部分を整理します。
   0〜3段階で調整できます。
   白い縁が残る → 強め
   髪や服が削れる → 弱め

2. PWA対応
   manifest.webmanifest / service-worker.js / アイコンを追加しました。
   GitHub PagesなどHTTPS上で公開後、iPhone Safariの
   「共有」→「ホーム画面に追加」でアプリ風に起動できます。

3. GitHub Pages向け
   すべて相対パスにしているので、リポジトリのサブディレクトリURLでも
   そのまま動く構成です。

【ローカルPCでテスト】
このフォルダで

    python -m http.server 8000 --bind 0.0.0.0

PC:
    http://localhost:8000

iPhone（同じWi-Fi）:
    http://PCのIPv4アドレス:8000

【GitHub Pagesへ置く場合】
このフォルダ内のファイルをGitHubリポジトリのルートへ置きます。

必要ファイル:
    index.html
    style.css
    app.js
    manifest.webmanifest
    service-worker.js
    icons/

GitHubで
    Settings
      → Pages
      → Build and deployment
      → Deploy from a branch
      → main / root
を選択します。

【重要】
人物切り抜きに使うMediaPipeライブラリとモデルは
jsDelivrから読み込むため、現段階では完全オフラインでは動きません。

写真そのものを外部へアップロードするコードは入っていません。

【次の候補 v0.4】
・人物と背景の明るさ自動調整
・色温度の自動調整
・足元の簡易影
・左 / 中央 / 右の自動配置候補
