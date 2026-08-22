import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args:["--no-sandbox"] });
const p = await b.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(String(e)));
p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`); await p.waitForTimeout(900);
const R = await p.evaluate(()=>{
  const out={};
  const mk=(l)=>{const pg=newPage(l,App.project.pages.length+1);App.project.pages.push(pg);App.pageIdx=App.project.pages.length-1;return pg;};
  const cable=(pg,n,decl)=>{ for(let i=0;i<n;i++) addWire(pg,[[80,60+i*5],[130,60+i*5]]);
    return addDevice(pg,`cable_core@${symCoresToSpan(decl||n)}`,100,60,{tag:"-WC"+(App.project.pages.length)}); };
  // ① 宣言4芯に心線6本
  let pg=mk("a"); const d1=cable(pg,6,4);
  out.coreMismatch=runDRC().filter(i=>i.target===d1.id).map(i=>i.msg.replace(/^-\S+\s/,""));
  // ② 宣言どおり
  pg=mk("b"); const d2=cable(pg,6,6);
  out.coreOk=runDRC().filter(i=>i.target===d2.id).map(i=>i.msg.replace(/^-\S+\s/,""));
  // ③ 両端接地が別ページ (A葉FE + B葉FE) → 検出されるか
  const pgA=mk("c1"); const cA=cable(pgA,4,4);
  const sh=addDevice(pgA,`shield@${symCoresToSpan(4)}`,100,60,{tag:"-SX"});
  const pin=devPins(sh)[0];
  addWire(pgA,[[pin.x,pin.y],[pin.x+15,pin.y]]); addDevice(pgA,"func_earth",pin.x+15,pin.y,{});
  addWire(pgA,[[pin.x,pin.y],[pin.x,pin.y+15]]); addDevice(pgA,"link",pin.x,pin.y+15,{tag:"-SHLD2"});
  const pgB=mk("c2"); addDevice(pgB,"link",60,60,{tag:"-SHLD2"});
  addWire(pgB,[[60,60],[80,60]]); addDevice(pgB,"func_earth",80,60,{});
  App.pageIdx=App.project.pages.indexOf(pgA);
  out.bothEndsCrossPage=runDRC().filter(i=>i.target===sh.id).map(i=>i.msg.replace(/^-\S+\s/,""));
  // ④ 別ページ PE のみ → PE 警告が出るか
  const pgC=mk("d1"); const cC=cable(pgC,4,4);
  const sh2=addDevice(pgC,`shield@${symCoresToSpan(4)}`,100,60,{tag:"-SY"});
  const p2=devPins(sh2)[0];
  addWire(pgC,[[p2.x,p2.y],[p2.x,p2.y+15]]); addDevice(pgC,"link",p2.x,p2.y+15,{tag:"-SHLD3"});
  const pgD=mk("d2"); addDevice(pgD,"link",60,60,{tag:"-SHLD3"});
  addWire(pgD,[[60,60],[80,60]]); addDevice(pgD,"prot_earth",80,60,{});
  App.pageIdx=App.project.pages.indexOf(pgC);
  out.peCrossPage=runDRC().filter(i=>i.target===sh2.id).map(i=>i.msg.replace(/^-\S+\s/,""));
  // ⑤ BOM に芯数が出るか
  out.bom=buildBOM().filter(r=>/多芯|シールド/.test(r.name)).map(r=>r.name+"×"+r.tags.length);
  return out;
});
console.log(JSON.stringify(R,null,1));
// 合否: 検図が出るべきところで出て、正しい図では出ないこと
const has = (a,re) => a.some(m=>re.test(m));
const checks = {
  coreMismatch: has(R.coreMismatch, /実際に通っている心線は 6 本/),
  coreOk: R.coreOk.length === 0,
  bothEndsCrossPage: has(R.bothEndsCrossPage, /2 箇所で接地/),
  peCrossPage: has(R.peCrossPage, /保護接地/),
  bomCores: R.bom.some(x=>/4芯/.test(x)) && R.bom.some(x=>/6芯/.test(x)),
};
const fail = Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
console.log("CHECKS:", JSON.stringify(checks), fail.length?"FAIL "+fail.join(","):"ok");
console.log("ERRORS:",errs.length,errs.slice(0,3));
await b.close();
if (fail.length || errs.length) process.exit(1);
