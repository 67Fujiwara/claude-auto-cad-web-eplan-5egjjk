import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args:["--no-sandbox"] });
const p = await b.newPage({viewport:{width:1500,height:950}});
const errs=[]; p.on("pageerror",e=>errs.push(String(e))); p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`);
await p.waitForTimeout(900);
const R = await p.evaluate(()=>{
  const out = {};
  out.base = { cable: !!SYMBOLS_BY_ID.cable_core.stretch, shield: !!SYMBOLS_BY_ID.shield, shieldJis: SYMBOLS_BY_ID.shield.jis };
  // 変種生成
  const v = symStretchVariant(SYMBOLS_BY_ID.cable_core, 60);
  out.variant = { id: v.id, bounds: v.bounds, span: v.span, hasOutline: /A5,5 /.test(v.body) && /L5,50/.test(v.body) };
  out.clamp = [symStretchSpan(SYMBOLS_BY_ID.cable_core, 3), symStretchSpan(SYMBOLS_BY_ID.cable_core, 999), symStretchSpan(SYMBOLS_BY_ID.cable_core, 47)];
  out.viaSymOf = symOf("shield@45").bounds;              // 未生成 id からの解決
  out.missingStays = symOf("nope@10").missing === true;   // 伸縮でないものは従来どおり
  // 配置 → プロパティで長さ変更
  const pg = newPage("試験", App.project.pages.length + 1);
  App.project.pages.push(pg); App.pageIdx = App.project.pages.length - 1;
  const d1 = addDevice(pg, "cable_core", 100, 60, {});
  const d2 = addDevice(pg, "shield", 140, 60, {});
  App.selection.clear(); App.selection.add(d1.id);
  UI.showProps();
  const inp = document.querySelector("#pSpan");
  out.propUI = !!inp && { value: inp.value, step: inp.step, max: inp.max };
  if (inp) { inp.value = "14"; inp.dispatchEvent(new Event("change", { bubbles: true })); }   // 14芯
  out.afterUI = { sym: pg.devices[0].sym, cores: symSpanToCores(symOf(pg.devices[0].sym).span),
                  bounds: symOf(pg.devices[0].sym).bounds };
  // 2本目も伸ばす
  d2.sym = "shield@100"; symOf(d2.sym);
  renderAll();
  const svg = document.querySelector("#canvas, svg")?.ownerDocument.body.innerHTML || "";
  // 画面に長円が描かれているか (心線囲み r=5 / 遮へい r=7)
  out.rendered = { cable: /A5,5 0 0 1 5,0/.test(svg), shield: /A7,7 0 0 1 7,0/.test(svg) };
  // BOM: 寸法違いでも1行にまとまるか
  addDevice(pg, "cable_core@40", 180, 60, {});
  const bom = buildBOM().filter(r=>r.name.includes("多芯"));
  out.bom = bom.map(r=>({ name: r.name, n: r.tags.length }));
  // DXF: 楕円が出力に含まれるか (円弧/ポリライン化)
  const dxf = pageToDXF(pg);
  out.dxfHasEnts = dxf.length > 500 && /ENTITIES/.test(dxf);
  // 保存 → 読込 (変種 id が復元できるか)
  const json = JSON.stringify(App.project);
  const clone = JSON.parse(json);
  const ids = clone.pages.at(-1).devices.map(d=>d.sym);
  const usedId = pg.devices[0].sym;        // 図面が実際に使っている寸法違い
  delete SYMBOLS_BY_ID[usedId];            // キャッシュを捨てて再解決させる
  out.reload = { ids, usedId, resolved: symOf(usedId).bounds, bodyBack: !!symOf(usedId).body };
  out.drc = runDRC().filter(i=>[d1.id,d2.id].includes(i.target)).map(i=>i.msg);
  return out;
});
console.log(JSON.stringify(R, null, 1));

// 回帰: 遮へい付きでも全心線の線番が自線の脇 (|dy| <= 2.5mm) にあり、検図の重なり警告が出ないこと
const LBL = await p.evaluate(()=>{
  const out={};
  [4,8,24].forEach(n=>{
    const pg=newPage("L"+n,App.project.pages.length+1); App.project.pages.push(pg); App.pageIdx=App.project.pages.length-1;
    for(let i=0;i<n;i++) addWire(pg,[[86,60+i*5],[114,60+i*5]]);
    const h=symCoresToSpan(n);
    addDevice(pg,`cable_core@${h}`,100,60,{tag:"-WL"+n});
    addDevice(pg,`shield@${h}`,100,60,{tag:"-WL"+n+"S"});
    autoNumberWires(); App.labelRev++;
    const dy=[];
    pg.wires.forEach(w=>{ if(w.pts[0][1]!==w.pts[1][1]) return;
      const pos=wireLabelPos(w,pg); if(pos) dy.push(Math.abs(pos[1]-w.pts[0][1])); });
    out[n]={ worst:+Math.max(...dy).toFixed(1),
             drc: runDRC().filter(i=>/線番.*重なって/.test(i.msg)).length };
    // 桁数スイープ: 線番が長くなっても線の脇にあり、囲みの輪郭を貫通しないこと
    ["W2-1","W2-12","W2-1234"].forEach(t=>{
      pg.wires.forEach((w,i)=>{ if(w.pts[0][1]===w.pts[1][1]){ w.num=t+i; w.fixed=true; w.numShow=true; } });
      App.labelRev++;
      let worst=0, pierce=0;
      pg.wires.forEach(w=>{ if(w.pts[0][1]!==w.pts[1][1]) return;
        const pos=wireLabelPos(w,pg); if(!pos) return;
        worst=Math.max(worst, Math.abs(pos[1]-w.pts[0][1]));
        // 図記号との重なりは検図 (drc) で見る。輪郭の貫通は wire-label-placement.mjs で
      });
      out[n+":"+t]={ worst:+worst.toFixed(1), pierce, drc: runDRC().filter(i=>/線番.*重なって/.test(i.msg)).length };
    });
  });
  return out;
});
const bad = Object.entries(LBL).filter(([k,v])=>v.worst>2.5||v.drc>0||(v.pierce||0)>0);
console.log("LABELS:", JSON.stringify(LBL), bad.length?"FAIL":"ok");
const R2 = R;
const checks = {
  variantOutline: R2.variant.hasOutline === true,
  rendered: R2.rendered.cable === true && R2.rendered.shield === true,
  uiCores: R2.afterUI.cores === 14,
  reload: Array.isArray(R2.reload.resolved) && R2.reload.bodyBack === true,
  bomCoreRows: R2.bom.length >= 1 && R2.bom.every(r=>/芯/.test(r.name)),
  labels: !bad.length,
};
const failed = Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
console.log("CHECKS:", JSON.stringify(checks), failed.length ? "FAIL "+failed.join(",") : "ok");
console.log("ERRORS:", errs.length, errs.slice(0,4));
if (failed.length || bad.length || errs.length) { await b.close(); process.exit(1); }
await b.close();
