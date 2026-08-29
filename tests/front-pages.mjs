/* 図面集の頭 3 枚 (表紙・目次・仕様) が標準で付くこと。

   ・defaultPages : 新規プロジェクトが 表紙 / 目次 / 仕様 2 枚 / 回路 の順で始まる
   ・coverDraw    : 表紙は客先名と装置名の 2 行 + 下線。プロパティで書き換わる
   ・tocAuto      : 目次はページ名と図番の一覧。ページを足すと自動で増え、
                    表紙と目次そのものは載らない
   ・coverPh      : 客先名の例示に実在の会社名を出さない (○○株式会社 △△工場)
   ・tocFull      : 目次は 1 枚 30 件で用紙いっぱい。31 件目からは次の目次へ送り、
                    目次が 1 枚しか無いときは「ほか n 件」と知らせる
   ・specDefault  : 仕様は既定の選択 (IP54 など) で ◯ が付いている
   ・specFormat   : 紙の仕様書と同じ表組み (使用環境・保護等級・材質・電源接続方法 /
                    単線の表・マークチューブの表と図) で描かれる
   ・specPrint    : 表紙・目次・仕様の中身は出図 (印刷・PDF・SVG) にも載る
   ・specWide     : 仕様は用紙いっぱいに広がる (下半分が空かない)
   ・specClick    : 図面の選択肢をクリックすると ◯ が移る (チェックするだけ)
   ・specMemo     : 「その他」用の記入欄はプロパティにあり、図面に出る
   ・drcSkip      : 表紙・目次・仕様は検図の対象外 (図枠の未接続などを出さない)
   ・noDraw       : これらのページでは配線ツールで線が引かれない
   ・addMenu      : あとから「表紙/目次/仕様を追加」でき、頭 3 枚の順に入る
   ・saveLoad     : 保存 → 読み込みで種別・選択・表紙の文字が残る */
import { chromium } from "playwright-core";
const b = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);

const R = await p.evaluate(async () => {
  const out = {};
  App.project = newProject("挽肉異物検査 AI 画像検査装置 電気図面");
  App.pageIdx = 0; App.selection.clear();
  UI.renumberPages();
  UI.refresh();
  await new Promise(r => setTimeout(r, 200));
  out.defaultPages = App.project.pages.map(pg => [pg.kind || "draw", pg.name]);

  // ── 表紙 ──
  const cover = App.project.pages[0];
  cover.cover = { customer: "○○株式会社 △△工場", title: "○○装置 電気図面" };
  App.pageIdx = 0; UI.refresh();
  await new Promise(r => setTimeout(r, 200));
  const svg = () => Editor.layers.sheet.innerHTML;
  out.coverDraw = {
    cust: svg().includes("○○株式会社 △△工場"),
    title: svg().includes("○○装置 電気図面"),
    underlines: (svg().match(/stroke-width="0.25"/g) || []).length >= 2,
  };
  // プロパティ欄が出て、書き換えると図面に反映される
  UI.showProps();
  await new Promise(r => setTimeout(r, 150));
  // 例示に実在の客先名を出さない (画面に残ると別の客先へ出図したときに事故になる)
  out.coverPh = (document.querySelector("#cvCust") || {}).placeholder || "";
  const cvc = document.querySelector("#cvCust");
  out.coverProp = !!cvc;
  if (cvc) {
    cvc.value = "○○食品 第2工場";
    cvc.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    out.coverProp = svg().includes("○○食品 第2工場") && cover.cover.customer === "○○食品 第2工場";
  }

  // ── 目次 ──
  App.pageIdx = 1; UI.refresh();
  await new Promise(r => setTimeout(r, 200));
  const before = tocRows().map(r2 => r2.name);
  UI.addPage();                       // 回路ページを 1 枚足す
  App.pageIdx = 1; UI.refresh();
  await new Promise(r => setTimeout(r, 200));
  out.tocAuto = {
    before, after: tocRows().map(r2 => r2.name),
    noCover: !tocRows().some(r2 => r2.name === "表紙" || r2.name === "目次"),
    drawn: svg().includes("メイン回路") && svg().includes("名称") && svg().includes("項"),
  };

  /* ── 目次は 1 枚 30 件 ── */
  {
    const keep = [...App.project.pages];        // 元の構成 (後で戻す)
    for (let i = 0; i < 40; i++) App.project.pages.push(newPage("追加 " + (i + 1), 0));
    UI.renumberPages();
    const toc = App.project.pages.find(pg => pg.kind === "toc");
    App.pageIdx = App.project.pages.indexOf(toc); UI.refresh();
    await new Promise(r => setTimeout(r, 200));
    const html = kindSVG(toc);        // 目次の中身だけ (図枠は含めない)
    const all = tocRows();
    out.tocFull = {
      rows: all.length,
      shown30: html.includes(all[29].name) && html.includes(all[29].no),   // 30 件目まで載る
      not31: !html.includes(all[30].no),                                   // 31 件目は次の目次へ
      note: /ほか \d+ 件/.test(html),
      // 用紙いっぱい: 表の下端が図枠の 70% より下まで届いている
      deep: (() => {
        const b = sheetInner();
        const ys = [...html.matchAll(/M[\d.]+,([\d.]+) H/g)].map(m => +m[1]);
        return ys.length ? Math.max(...ys) > b.y + b.h * 0.7 : false;
      })(),
    };
    // 目次をもう 1 枚足すと続きが載る
    UI.addSpecialPage("toc");
    UI.renumberPages();
    const tocs = App.project.pages.filter(pg => pg.kind === "toc");
    App.pageIdx = App.project.pages.indexOf(tocs[1]); UI.refresh();
    await new Promise(r => setTimeout(r, 200));
    const html2 = kindSVG(tocs[1]);
    const all2 = tocRows();
    out.tocFull.second = html2.includes(all2[30].no) && !html2.includes(all2[0].no);
    // 元の構成へ戻す (目次を足したので、配列ごと差し替える)
    App.project.pages = keep;
    UI.renumberPages();
    App.pageIdx = 0;
  }

  // ── 仕様 ──
  const spec = App.project.pages.find(pg => pg.kind === "spec");
  App.pageIdx = App.project.pages.indexOf(spec);
  UI.refresh();
  await new Promise(r => setTimeout(r, 200));
  // 選んだ番号は ◯ (楕円) で囲む。既定は全 10 組ぶん付いている
  out.specDefault = { ip: spec.spec.sel.ip, env: spec.spec.sel.env,
    circles: (svg().match(/<ellipse /g) || []).length };
  /* 紙の仕様書と同じ表組みで描けているか (見出し・単線の表・チューブの図) */
  const html = svg();
  out.specFormat = {
    heads: ["制御盤筐体仕様", "制御盤配線仕様", "使用環境", "保護等級", "材質", "電源接続方法",
      "単線", "マークチューブ・記名板", "特記事項", "当社標準", "御社指定方法"].filter(t => !html.includes(t)),
    wire: ["回路", "用途", "線色", "定格", "AC200V", "AC100V", "DC24V", "計装", "3相", "制御回路",
      "300V 以上", "30V 以上シールド付"].filter(t => !html.includes(t)),
    mat: ["鉄", "ステンレス", "無処理 (購入標準)", "ヘアライン", "IP54"].filter(t => !html.includes(t)),
    tubeFig: (html.match(/>1234</g) || []).length,       // 4 方向のマークチューブ
    rects: (html.match(/<rect /g) || []).length,          // 表のます
  };
  /* 用紙いっぱいに広げて描く (紙の様式のままだと下半分が空く)。
     仕様の中身だけを見る — 図枠の線は含めない */
  {
    const b = sheetInner();
    const inner = kindSVG(spec);
    const ys = [...inner.matchAll(/<rect [^>]*y="([\d.]+)"[^>]*height="([\d.]+)"/g)]
      .map(m => +m[1] + +m[2]);
    out.specWide = { bottom: ys.length ? +Math.max(...ys).toFixed(1) : 0, want: +(b.y + b.h * 0.7).toFixed(1) };
  }
  // 出図 (印刷・PDF・SVG) にも同じ中身が載る
  const ex = exportSheetSVG(spec);
  out.specPrint = ex.includes("制御盤配線仕様") && ex.includes("マークチューブ・記名板") && /<rect /.test(ex);
  return out;
});

// ── 仕様: 図面の選択肢を実クリック ──
const clicked = await p.evaluate(async () => {
  const o = Editor.specBoxes.find(q => q.k === "ip" && q.i === 0);
  const bb = Editor.svg.getBoundingClientRect();
  const { tx, ty, s } = Editor.view;
  return { x: bb.left + tx + (o.x + o.w / 2) * s, y: bb.top + ty + (o.y + o.h / 2) * s };
});
await p.mouse.click(clicked.x, clicked.y);
await p.waitForTimeout(200);
R.specClick = await p.evaluate(() => {
  const spec = App.project.pages.find(pg => pg.kind === "spec");
  return { ip: spec.spec.sel.ip };
});

R.rest = await p.evaluate(async () => {
  const out = {};
  const spec = App.project.pages.find(pg => pg.kind === "spec");
  // 記入欄 (プロパティ)
  UI.showProps();
  await new Promise(r => setTimeout(r, 150));
  const memo = document.querySelector('.spMemo[data-k="env"]');
  out.memoField = !!memo;
  if (memo) {
    memo.value = "冷蔵環境 (5℃)";
    memo.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    out.memoDrawn = Editor.layers.sheet.innerHTML.includes("冷蔵環境 (5℃)") && spec.spec.memo.env === "冷蔵環境 (5℃)";
  }
  /* 検図は頭 3 枚を見ない。素通しでは確かめられないので、回路ページなら
     必ず指摘が出るもの (未接続の端子を持つ機器) を仕様ページへ置いて試す */
  addDevice(spec, "coil", 100, 100, { tag: "-KX" });
  const kindNos = App.project.pages.filter(pg => pg.kind).map(pg => pg.no);
  const all = runDRC();
  out.drcSkip = all.every(i => !kindNos.includes(i.page)) && all.every(i => i.target !== spec.devices[0].id);
  spec.devices.pop();
  // 配線ツールでは線が引かれない
  UI.setTool("wire");
  const before = spec.wires.length;
  /* 選択肢の枠に当たらない空白 (図枠の下の方) で試す —
     選択肢の上だと「仕様を選ぶ」動作になってしまい、線を引かない確認にならない */
  const bb = Editor.svg.getBoundingClientRect();
  const { tx, ty, s: vs } = Editor.view;
  const empty = { x: SHEET.w * 0.25, y: SHEET.h * 0.8 };
  const hit = (Editor.specBoxes || []).some(o =>
    empty.x >= o.x && empty.x <= o.x + o.w && empty.y >= o.y && empty.y <= o.y + o.h);
  const cx = bb.left + tx + empty.x * vs, cy = bb.top + ty + empty.y * vs;
  const ev = (t) => Editor.svg.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: cx, clientY: cy }));
  ev("mousedown"); ev("mouseup");
  ev("mousedown"); ev("mouseup");
  out.noDraw = !hit && spec.wires.length === before && !Editor.wireDraft
    && spec.spec.sel.ip === 0;          // 仕様の選択も変わっていないこと
  UI.setTool("select");
  // あとから追加 (頭 3 枚の順に入る)
  UI.addSpecialPage("toc");
  out.addMenu = App.project.pages.map(pg => pg.kind || "draw").join(",");
  // 保存 → 読み込み
  const json = JSON.stringify(App.project);
  App.project = JSON.parse(json);
  App.pageIdx = 0; UI.refresh();
  await new Promise(r => setTimeout(r, 200));
  const c2 = App.project.pages[0], s2 = App.project.pages.find(pg => pg.kind === "spec");
  out.saveLoad = { kind: c2.kind, cust: c2.cover && c2.cover.customer,
    ip: s2.spec && s2.spec.sel.ip, memo: s2.spec && s2.spec.memo.env };
  return out;
});

const checks = {
  noPageErrors: errs.length === 0,
  defaultPages: JSON.stringify(R.defaultPages) ===
    JSON.stringify([["cover", "表紙"], ["toc", "目次"], ["spec", "仕様"], ["spec", "仕様 (2)"],
      ["draw", "メイン回路"]]),
  coverDraw: R.coverDraw.cust && R.coverDraw.title && R.coverDraw.underlines && R.coverProp === true,
  coverPh: /^例: [○◯△]/.test(R.coverPh) && !/株式会社\s*\S/.test(R.coverPh.replace("○○株式会社", "")),
  tocAuto: R.tocAuto.after.length === R.tocAuto.before.length + 1 && R.tocAuto.noCover && R.tocAuto.drawn,
  tocFull: R.tocFull.shown30 === true && R.tocFull.not31 === true && R.tocFull.note === true
    && R.tocFull.deep === true && R.tocFull.second === true,
  specDefault: R.specDefault.ip === 5 && R.specDefault.env === 0 && R.specDefault.circles >= 10,
  specFormat: R.specFormat.heads.length === 0 && R.specFormat.wire.length === 0
    && R.specFormat.mat.length === 0 && R.specFormat.tubeFig === 4
    && R.specFormat.rects >= 40,
  specPrint: R.specPrint === true,
  specWide: R.specWide.bottom > R.specWide.want,
  specClick: R.specClick.ip === 0,
  specMemo: R.rest.memoField === true && R.rest.memoDrawn === true,
  drcSkip: R.rest.drcSkip === true,
  noDraw: R.rest.noDraw === true,
  addMenu: R.rest.addMenu === "cover,toc,toc,spec,spec,draw,draw",
  saveLoad: R.rest.saveLoad.kind === "cover" && R.rest.saveLoad.cust === "○○食品 第2工場"
    && R.rest.saveLoad.ip === 0 && R.rest.saveLoad.memo === "冷蔵環境 (5℃)",
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R, errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("front-pages OK");
