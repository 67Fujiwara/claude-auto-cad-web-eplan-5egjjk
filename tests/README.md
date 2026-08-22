# 回帰テスト

`index.html` を Playwright (playwright-core) の Chromium で開き、実際の描画と検図を確かめます。
失敗したテストは exit code 1 を返すので、まとめて実行するときは:

```sh
sh tests/run.sh          # Chrome の場所は環境変数 CHROME で上書きできます
```

事前に `npm i playwright-core` した場所へ `tests/node_modules` を用意してください
(このリポジトリは依存ゼロで動くため、テストだけが Node と playwright-core を使います)。

| ファイル | 見ているもの |
| --- | --- |
| `cable-stretch.mjs` | 多芯ケーブル囲み・シールドの伸縮 (寸法違いの生成・保存/再読込・DXF・部品表)、線番の位置 |
| `wire-label-placement.mjs` | 線番が自分の線の脇にあり、実際の輪郭 (長円) を貫通せず、左右にばらけないこと |
| `cable-drc.mjs` | 芯数の不一致・遮へいの両端接地/PE 誤接続 (ページをまたぐ場合を含む)・部品表の芯数 |
