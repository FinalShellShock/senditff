// Does paying a premium hurt, and does it depend on what you buy?
//
// Sits between two things: Johnny's warning not to open the floodgates to junk
// held together by a sweetener, and the diagnostic showing that the trades
// which acquire quality die at the counterparty's fit gate, never at the
// user's. Closing those needs paying more, so the question is whether paying
// more is a mistake.
//
//   node scripts/research/payup.mjs

import { readFileSync } from "node:fs";
const cache=JSON.parse(readFileSync("scripts/research/outcomes-cache.json","utf8"));
const vals=JSON.parse(readFileSync("scripts/research/values-history.json","utf8"));
const trades=Object.values(JSON.parse(readFileSync("scripts/research/trades-with-ids.json","utf8"))).flat();
const played=id=>(cache[id]?.rosters??[]).some(r=>r.pf>0);
const succ={}; for(const [id,v] of Object.entries(cache)) if(v.prev) succ[v.prev]=id;
const rankPct=(l,o)=>{const g=cache[l];if(!g||g.teams<2)return null;const r=g.rosters.find(x=>x.ownerId===o);return r?(r.rank-1)/(g.teams-1):null;};
const ownerOf=(l,r)=>cache[l]?.rosters.find(x=>x.rosterId===r)?.ownerId??null;
const rankAt=(pid,ym)=>{const h=vals[pid];if(!h)return null;let b=null;for(const [m,e] of h){if(m<=ym)b=e;else break;}return b;};
const valOf=r=>r==null?0:1000*Math.exp(-r/60);
const obs=[];
for(const t of trades){
  const n=succ[t.league]; if(!n||!played(t.league)||!played(n)) continue;
  const ym=Number(cache[t.league].season)*100+9;
  const sideVal=s=>s.players.reduce((a,p)=>a+valOf(rankAt(p.id,ym)),0);
  for(const s of t.sides){
    const o=ownerOf(t.league,s.rosterId); if(!o) continue;
    const b=rankPct(t.league,o),a=rankPct(n,o); if(b==null||a==null) continue;
    const other=t.sides.find(x=>x!==s);
    const got=sideVal(s), gave=sideVal(other);
    if(got+gave<=0) continue;
    const delta=(got-gave)/Math.max(got,gave);   // + = I received more value
    let best=null; for(const p of s.players){const r=rankAt(p.id,ym); if(r!=null&&(best==null||r<best))best=r;}
    obs.push({b,d:b-a,delta,best});
  }
}
const bk=b=>b<0.25?0:b<0.5?1:b<0.75?2:3;
const base=new Map();
for(const o of obs){const k=bk(o.b);const c=base.get(k)??{n:0,s:0};c.n++;c.s+=o.d;base.set(k,c);}
const bf=b=>{const v=base.get(bk(b));return v?v.s/v.n:0;};
const rep=(l,p,min=80)=>{const g=obs.filter(p);
  if(g.length<min){console.log(`   ${l.padEnd(44)} n=${g.length}`);return;}
  console.log(`   ${l.padEnd(44)} ${(100*g.filter(o=>o.d-bf(o.b)>0).length/g.length).toFixed(0)}%  (n=${g.length})`);};
console.log(`observations: ${obs.length}\n`);
console.log("Does paying MORE value than you get hurt?");
rep("received much more value (+25% or better)", o=>o.delta>=0.25);
rep("received slightly more (+5 to +25%)",       o=>o.delta>=0.05&&o.delta<0.25);
rep("roughly even (-5 to +5%)",                  o=>o.delta>-0.05&&o.delta<0.05);
rep("paid slightly more (-5 to -25%)",           o=>o.delta<=-0.05&&o.delta>-0.25);
rep("paid much more (-25% or worse)",            o=>o.delta<=-0.25);
console.log("\nOverpaying SPECIFICALLY to land a top-24 player:");
rep("paid up (-5% or worse) AND landed top-24",  o=>o.delta<=-0.05&&o.best!=null&&o.best<=24, 40);
rep("paid up AND landed nothing better than 60", o=>o.delta<=-0.05&&(o.best==null||o.best>60), 40);
