/* 出図まわり — 図面一式をまとめて出せること。

   ・newBtn    : 「新規」ボタンがヘッダにあり、押すと新しい図面になる
   ・pdfOne    : 全ページが 1 本の PDF になる (ページ数ぶんのページ辞書が入る)
   ・pdfValid  : PDF の体裁 (%PDF ヘッダ・xref の位置・%%EOF) が正しい
   ・zipPack   : ZIP に図面一式が入る (書庫の中はフォルダ 1 階層)
   ・zipRead   : ZIP の中身が壊れていない (CRC と大きさが合う)
   ・menu      : ファイルメニューに「PDF出力 (全ページを1ファイル)」がある
   ・relForm   : 設計完了の画面に PDF の 2 パターン (社内保存用 / 顧客提出用) がある
   ・relPages  : 顧客提出用のページ = 全ページ − 仕様のページ (社内保存用は全ページ)
   ・relToc    : 顧客提出用の目次には仕様の行が無い (社内保存用には有る)
   ・relNo     : 用紙右下の「n / N」はその版の通し。図番は両方で同じ
   ・relKeep   : 出図しても元の図面のページ番号・ページ数は変わらない
   ・relOut    : 設計完了で PDF が 2 本 (社内保存用 / 顧客提出用) 出る。
                 顧客提出用の中身は仕様のページぶん少ない */
import { chromium } from "playwright-core";
import { writeFileSync, rmSync } from "fs";
import { execFileSync } from "child_process";

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
  const nb = document.getElementById("btnNew");
  out.newBtn = { exists: !!nb, label: nb && nb.textContent.trim() };

  App.project = newProject("出図テスト");
  App.project.pages.push(newPage("追加ページ", App.project.pages.length + 1));
  UI.renumberPages();
  const pages = App.project.pages;
  out.pageCount = pages.length;

  // ── PDF (全ページを 1 ファイル) ──
  const blob = await buildPDF(pages, { dpi: 100 });
  const buf = new Uint8Array(await blob.arrayBuffer());
  const txt = new TextDecoder("latin1").decode(buf);
  const sx = /startxref\s+(\d+)/.exec(txt);
  out.pdfOne = { type: blob.type, pages: (txt.match(/\/Type \/Page[^s]/g) || []).length, want: pages.length };
  out.pdfValid = {
    head: txt.startsWith("%PDF-"),
    eof: txt.trimEnd().endsWith("%%EOF"),
    xrefAt: !!sx && txt.slice(+sx[1], +sx[1] + 4) === "xref",
    objs: [...txt.matchAll(/\n(\d{10}) 00000 n/g)].every(m => /^\d+ 0 obj/.test(txt.slice(+m[1], +m[1] + 12))),
    size: buf.length,
  };

  // ── ZIP ──
  const zip = buildZIP([
    { name: "zumen_rev0/a.dxf", data: "0\nSECTION\n" },
    { name: "zumen_rev0/b.json", data: '{"x":1}' },
  ]);
  const z = new Uint8Array(await zip.arrayBuffer());
  // 書庫の見出し (ローカル / 中央目録 / 終端) を生バイトで数える
  const sigCount = (a, b2) => {
    let n = 0;
    for (let k = 0; k + 3 < z.length; k++) if (z[k] === 80 && z[k + 1] === 75 && z[k + 2] === a && z[k + 3] === b2) n++;
    return n;
  };
  out.zipPack = { type: zip.type, local: sigCount(3, 4), central: sigCount(1, 2), end: sigCount(5, 6) };
  out.zipBytes = Array.from(z);
  out.dirApi = typeof FS_DIR_API !== "undefined";
  return out;
});

// ZIP を Node 側で展開して壊れていないか確かめる
const zpath = "/tmp/ecad-release-test.zip";
writeFileSync(zpath, Buffer.from(R.zipBytes));
let zipOK = false, zipInfo = "";
try {
  const py = [
    "import zipfile",
    `z = zipfile.ZipFile(${JSON.stringify(zpath)})`,
    "print(z.testzip() is None, '|'.join(z.namelist()), z.read('zumen_rev0/b.json').decode())",
  ].join("\n");
  zipInfo = execFileSync("python3", ["-c", py], { encoding: "utf8" }).trim();
  zipOK = zipInfo.startsWith("True") && zipInfo.includes('{"x":1}') && zipInfo.includes("zumen_rev0/a.dxf");
} catch (e) { zipInfo = String(e).slice(0, 160); }
rmSync(zpath, { force: true });

/* ── 設計完了の PDF 2 パターン ── */
const R2 = await p.evaluate(async () => {
  const o = {};
  App.project = newProject("2パターン出図"); UI.renumberPages();
  const pages = App.project.pages;
  const specNos = pages.filter(pg => pg.kind === "spec").map(pg => pageDwgNo(pg));
  o.count = { all: pages.length, spec: specNos.length, specNos,
    int: releasePages("internal").length, cus: releasePages("customer").length,
    cusSpec: releasePages("customer").filter(pg => pg.kind === "spec").length };

  // 版ごとの目次・表題欄
  const look = kind => withReleaseProject(kind, list => {
    const toc = list.find(pg => pg.kind === "toc");
    const draw = list.find(isDrawingPage);
    applySheet(draw);
    const tb = sheetSVG(draw);
    return {
      total: list.length,
      tocSpec: specNos.filter(n => toc && kindSVG(toc).includes(`>${n}<`)).length,
      tocDraw: !!toc && kindSVG(toc).includes(`>${pageDwgNo(draw)}<`),
      no: draw.no, dwgNo: pageDwgNo(draw),
      tbNo: tb.includes(`>${draw.no} / ${list.length}<`),
    };
  });
  o.int = await look("internal");
  o.cus = await look("customer");
  // 元の図面は書き換わっていないこと
  o.keep = { n: App.project.pages.length, nos: App.project.pages.map(pg => pg.no).join(","),
    idx: App.pageIdx };

  // 実際に設計完了を走らせて、出てくるファイルを見る (保存は横取りする)
  const grabbed = [];
  const keepSave = window.saveReleaseFiles;
  window.saveReleaseFiles = async (out2) => {
    for (const f of out2) {
      const bytes = f.data instanceof Blob ? new Uint8Array(await f.data.arrayBuffer()) : null;
      const txt = bytes ? new TextDecoder("latin1").decode(bytes) : "";
      grabbed.push({ name: f.name, pages: (txt.match(/\/Type \/Page[^s]/g) || []).length,
        pdf: txt.startsWith("%PDF-") });
    }
    return { how: "テスト", name: "" };
  };
  await UI.runRelease({ dxf: false, json: false, pdfIn: true, pdfCus: true, dpi: 72, pack: "zip", rev: "0" });
  window.saveReleaseFiles = keepSave;
  o.out = grabbed;
  return o;
});

const relForm = await p.evaluate(() => {
  UI.finishDesign();
  const labs = [...document.querySelectorAll(".modal .prop-row label.chk")].map(e => e.textContent.trim());
  const ids = [...document.querySelectorAll(".modal input[type=checkbox]")].map(e => e.id);
  UI.closeModal && UI.closeModal();
  document.querySelectorAll(".modal-x, .mod-close").forEach(x => x.click());
  return { labs, ids };
});

const menuHas = await p.evaluate(() => {
  document.querySelector('#menubar .menu[data-menu="file"]').click();
  const items = [...document.querySelectorAll(".dropdown .dd-item")].map(e => e.textContent);
  UI.closeDropdown();
  return items.join(" / ");
});

const checks = {
  noPageErrors: errs.length === 0,
  newBtn: R.newBtn.exists === true && /新規/.test(R.newBtn.label || ""),
  pdfOne: R.pdfOne.type === "application/pdf" && R.pdfOne.pages === R.pdfOne.want && R.pdfOne.want >= 4,
  pdfValid: R.pdfValid.head && R.pdfValid.eof && R.pdfValid.xrefAt && R.pdfValid.objs && R.pdfValid.size > 10000,
  zipPack: R.zipPack.type === "application/zip" && R.zipPack.local === 2 && R.zipPack.central === 2 && R.zipPack.end === 1,
  zipRead: zipOK === true,
  menu: menuHas.includes("PDF出力 (全ページを1ファイル)"),
  relForm: relForm.ids.includes("rlPdfIn") && relForm.ids.includes("rlPdfCus")
    && relForm.labs.some(t => /社内保存用/.test(t)) && relForm.labs.some(t => /顧客提出用/.test(t)),
  relPages: R2.count.spec >= 2 && R2.count.int === R2.count.all
    && R2.count.cus === R2.count.all - R2.count.spec && R2.count.cusSpec === 0,
  relToc: R2.int.tocSpec === R2.count.spec && R2.cus.tocSpec === 0
    && R2.int.tocDraw === true && R2.cus.tocDraw === true,
  relNo: R2.int.tbNo === true && R2.cus.tbNo === true
    && R2.cus.no === R2.int.no - R2.count.spec && R2.cus.total === R2.int.total - R2.count.spec
    && R2.cus.dwgNo === R2.int.dwgNo,
  relKeep: R2.keep.n === R2.count.all
    && R2.keep.nos === Array.from({ length: R2.count.all }, (_, i) => i + 1).join(","),
  relOut: R2.out.length === 2 && R2.out.every(f => f.pdf === true)
    && /社内保存用\.pdf$/.test(R2.out[0].name) && /顧客提出用\.pdf$/.test(R2.out[1].name)
    && R2.out[0].pages === R2.count.all && R2.out[1].pages === R2.count.all - R2.count.spec,
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R: { ...R, zipBytes: R.zipBytes.length }, R2, relForm, zipInfo, menuHas: menuHas.slice(0, 200), errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("release-pack OK");
