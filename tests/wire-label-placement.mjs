import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args:["--no-sandbox"] });
const p = await b.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(String(e)));
await p.goto(`file://${new URL("../index.html", import.meta.url).pathname}`); await p.waitForTimeout(900);
const R = await p.evaluate(()=>{
  const NS="http://www.w3.org/2000/svg";
  const probe=document.createElementNS(NS,"svg"); probe.style.cssText="position:absolute;left:-9999px"; document.body.appendChild(probe);
  // 実輪郭を 1度刻みでサンプリングして、線番の箱と交差するか (障害物モデルに依存しない判定)
  const outlinePts=(dev)=>{
    const sym=symOf(dev.sym); const d=/d="([^"]*)"/.exec(sym.body)[1];
    const el=document.createElementNS(NS,"path"); el.setAttribute("d",d); probe.appendChild(el);
    const L=el.getTotalLength(), out=[];
    for(let i=0;i<720;i++){ const q=el.getPointAtLength(L*i/720); out.push(pinAbs(dev,{x:q.x,y:q.y})); }
    el.remove(); return out;
  };
  const run=(n,txt,X1b)=>{
    const pg=newPage("v"+n+txt,App.project.pages.length+1); App.project.pages.push(pg); App.pageIdx=App.project.pages.length-1;
    const X0=80, X1=X1b||120;
    for(let i=0;i<n;i++) addWire(pg,[[X0,60+i*5],[X1,60+i*5]]);
    const h=symCoresToSpan(n);
    const d1=addDevice(pg,`cable_core@${h}`,100,60,{tag:"-WA"});
    const d2=addDevice(pg,`shield@${h}`,100,60,{tag:"-WAS"});
    pg.wires.forEach((w,i)=>{ if(w.pts[0][1]===w.pts[1][1]){ w.num=txt+(i+1); w.fixed=true; w.numShow=true; } });
    App.labelRev++;
    const pts=[...outlinePts(d1),...outlinePts(d2)];
    const res={dy:[],x:[],outSeg:0,pierce:0};
    pg.wires.forEach(w=>{ if(w.pts[0][1]!==w.pts[1][1]) return;
      const pos=wireLabelPos(w,pg); if(!pos) return;
      const bx=wireNumBox(w,pos[0],pos[1],pos[2]);
      res.dy.push(+(pos[1]-w.pts[0][1]).toFixed(1));
      res.x.push(+bx.x.toFixed(1));
      const ov = Math.max(0, X0-bx.x) + Math.max(0, bx.x+bx.w-X1);
      if (ov > 0.01) { res.outSeg++; res.maxOver = Math.max(res.maxOver||0, +ov.toFixed(1)); }
      if (pts.some(q=>q.x>=bx.x&&q.x<=bx.x+bx.w&&q.y>=bx.y&&q.y<=bx.y+bx.h)) res.pierce++;
    });
    res.worstDy=Math.max(...res.dy.map(Math.abs));
    res.xSpread=+(Math.max(...res.x)-Math.min(...res.x)).toFixed(1);
    return res;
  };
  const out={};
  ["20","W2-1","W2-1234"].forEach(t=>{ out["4:"+t]=run(4,t); out["8:"+t]=run(8,t); });
  out["4:W2-1234(長い線)"]=run(4,"W2-1234",150);
  probe.remove(); return out;
});
for (const [k,v] of Object.entries(R)) console.log(k.padEnd(18), "dy≤",v.worstDy, "線外",v.outSeg, "最大はみ出し",v.maxOver||0, "輪郭貫通",v.pierce, "x幅",v.xSpread);
// 合否: 自線の脇 (|dy| <= 2.5mm) / 実輪郭を貫通しない / 線番が左右にばらけない
const fail = Object.entries(R).filter(([k,v]) => v.worstDy > 2.5 || v.pierce > 0 || v.xSpread > 16);
console.log("RESULT:", fail.length ? "FAIL " + fail.map(([k])=>k).join(",") : "ok");
console.log("ERRORS:",errs.length);
await b.close();
if (fail.length || errs.length) process.exit(1);
