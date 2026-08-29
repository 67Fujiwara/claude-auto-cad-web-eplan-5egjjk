/* 出図まわり — 図面一式をまとめて出せること。

   ・newBtn    : 「新規」ボタンがヘッダにあり、押すと新しい図面になる
   ・pdfOne    : 全ページが 1 本の PDF になる (ページ数ぶんのページ辞書が入る)
   ・pdfValid  : PDF の体裁 (%PDF ヘッダ・xref の位置・%%EOF) が正しい
   ・zipPack   : ZIP に図面一式が入る (書庫の中はフォルダ 1 階層)
   ・zipRead   : ZIP の中身が壊れていない (CRC と大きさが合う)
   ・menu      : ファイルメニューに「PDF出力 (全ページを1ファイル)」がある */
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
};
const bad = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ checks, R: { ...R, zipBytes: R.zipBytes.length }, zipInfo, menuHas: menuHas.slice(0, 200), errs: errs.slice(0, 3) }, null, 1));
await b.close();
if (bad.length) { console.error("FAIL:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("release-pack OK");
