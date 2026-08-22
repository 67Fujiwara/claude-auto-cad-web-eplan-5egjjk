import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args:["--no-sandbox"] });
const p = await b.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(String(e)));
p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`); await p.waitForTimeout(900);
const R = await p.evaluate(()=>{
  const out={};
  const mk=(l)=>{const pg=newPage(l,App.project.pages.length+1);App.project.pages.push(pg);App.pageIdx=App.project.pages.length-1;return pg;};
  const cable=(pg,n,decl)=>{ for(let i=0;i<n;i++) addWire(pg,[[60,60+i*5],[150,60+i*5]]);
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
  // ⑤ 正しく描いた遮へい (ドレン線を片端だけ FE へ) では検図が 1 件も出ないこと。
  //    「出るべきものが出る」だけでなく「出てはいけないものが出ない」も見る —
  //    以前ここでドレン線の始点を「囲みの中で終わっている配線」と誤検出していた
  const pgE=mk("e"); const cE=cable(pgE,4,4);
  for(let i=0;i<4;i++){ addDevice(pgE,"terminal",80,60+i*5,{tag:"",rot:90}); addDevice(pgE,"terminal",130,60+i*5,{tag:"",rot:270}); }
  const shE=addDevice(pgE,`shield@${symCoresToSpan(4)}`,100,60,{tag:"-SZ"});
  const pE=devPins(shE)[0], feE=pinAbs(shE,{x:10,y:symCoresToSpan(4)+10});
  addWire(pgE,[[pE.x,pE.y],[feE.x,feE.y]]); addDevice(pgE,"func_earth",feE.x,feE.y,{tag:"-FEZ"});
  App.pageIdx=App.project.pages.indexOf(pgE);
  out.goodShield=runDRC().filter(i=>i.page===pgE.no).map(i=>i.msg);
  // ⑥ 遮へいだけを導体に掛けた図 (シールド線・同軸) も通ること
  const pgF=mk("f");
  addWire(pgF,[[60,60],[150,60]]);
  addDevice(pgF,"terminal",80,60,{tag:"",rot:90}); addDevice(pgF,"terminal",130,60,{tag:"",rot:270});
  const shF=addDevice(pgF,"shield@10",100,60,{tag:"-SC"});
  const pF=devPins(shF)[0], feF=pinAbs(shF,{x:10,y:20});
  addWire(pgF,[[pF.x,pF.y],[feF.x,feF.y]]); addDevice(pgF,"func_earth",feF.x,feF.y,{tag:"-FEC"});
  App.pageIdx=App.project.pages.indexOf(pgF);
  out.coax=runDRC().filter(i=>i.page===pgF.no).map(i=>i.msg);
  // ⑦ 芯数を変えると相方の遮へいも一緒に変わること (1本のケーブルだから)
  const pgG=mk("g"); const cG=cable(pgG,4,4);
  const shG=addDevice(pgG,`shield@${symCoresToSpan(4)}`,100,60,{tag:"-SG"});
  const mate=cablePartner(pgG,cG);
  out.partner = mate === shG;
  // ⑧ BOM: 心線囲みと遮へいが 1 行にまとまり、長さ (m) が集計されること
  cG.props={len:12.5}; shG.props={len:12.5};
  out.bom=buildBOM().filter(r=>/ケーブル|シールド線/.test(r.name)).map(r=>r.name+"×"+r.tags.length+(r.len?"/"+r.len+"m":""));
  out.csv=bomCSV().split("\n")[0];
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
  goodShield: R.goodShield.length === 0,                       // 正しい図では無言
  coax: R.coax.length === 0,                                   // 遮へい単体も無言
  partner: R.partner === true,
  bomMerged: R.bom.some(x=>/^多芯ケーブル 4芯 \(遮へい付\)×\d+\/12\.5m$/.test(x)),  // 1行・長さ集計
  bomSolo: R.bom.some(x=>/^シールド線 1芯/.test(x)),           // 遮へい単体は別品目
  csvLen: /長さ \(m\)/.test(R.csv),
};
const fail = Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
console.log("CHECKS:", JSON.stringify(checks), fail.length?"FAIL "+fail.join(","):"ok");
console.log("ERRORS:",errs.length,errs.slice(0,3));
await b.close();
if (fail.length || errs.length) process.exit(1);
