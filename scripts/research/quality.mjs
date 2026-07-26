// Does WHO you get predict the outcome, more than how the trade is shaped?
//
// Johnny's argument, which turned out to be the right one: a pick is easy to
// value-match against a player, so leaning on picks makes the engine's job
// easier while making its output worse. Matching value is easy. Finding a
// trade that helps someone's team is hard.
//
// He was right and I had made the opposite case from a frequency argument
// (picks are 55% of traded assets), which is the exact error this whole study
// kept catching: frequency is what gets ACCEPTED, not what WORKS.
//
// Checked before building anything, and it killed two of my own proposals:
//
//   shape:  both sides 2+  51%   got 1 gave 2+  52%
//           got 2+ gave 1  47%   straight 1-for-1  52%
//   picks:  picks-only return 51%, i.e. noise
//
// So the 44% of real trades our engine structurally cannot build would perform
// at baseline, and picks do not help either. What DOES predict the outcome is
// below.
//
//   node scripts/research/quality.mjs

import { readFileSync } from "node:fs";
const cache=JSON.parse(readFileSync("scripts/research/outcomes-cache.json","utf8"));
const vals=JSON.parse(readFileSync("scripts/research/values-history.json","utf8"));
const trades=Object.values(JSON.parse(readFileSync("scripts/research/trades-with-ids.json","utf8"))).flat();
const played=id=>(cache[id]?.rosters??[]).some(r=>r.pf>0);
const succ={}; for(const [id,v] of Object.entries(cache)) if(v.prev) succ[v.prev]=id;
const rankPct=(l,o)=>{const g=cache[l];if(!g||g.teams<2)return null;const r=g.rosters.find(x=>x.ownerId===o);return r?(r.rank-1)/(g.teams-1):null;};
const ownerOf=(l,r)=>cache[l]?.rosters.find(x=>x.rosterId===r)?.ownerId??null;
const rankAt=(pid,ym)=>{const h=vals[pid];if(!h)return null;let b=null;for(const [m,e] of h){if(m<=ym)b=e;else break;}return b;};
const best=side=>{let r=null;for(const p of side.players){const x=rankAt(p.id,side._ym);if(x!=null&&(r==null||x<r))r=x;}return r;};

const obs=[];
for(const t of trades){
  const n=succ[t.league]; if(!n||!played(t.league)||!played(n)) continue;
  const ym=Number(cache[t.league].season)*100+9;
  t.sides.forEach(s=>{s._ym=ym;});
  const [A,B]=t.sides;
  const bA=best(A), bB=best(B);
  for(const s of t.sides){
    const o=ownerOf(t.league,s.rosterId); if(!o) continue;
    const b=rankPct(t.league,o), a=rankPct(n,o); if(b==null||a==null) continue;
    const mine=s===A?bA:bB, theirs=s===A?bB:bA;
    obs.push({b,delta:b-a,mine,theirs});
  }
}
const bk=b=>b<0.25?0:b<0.5?1:b<0.75?2:3;
const base=new Map();
for(const o of obs){const k=bk(o.b);const c=base.get(k)??{n:0,s:0};c.n++;c.s+=o.delta;base.set(k,c);}
const bf=b=>{const v=base.get(bk(b));return v?v.s/v.n:0;};
const rep=(l,p)=>{const g=obs.filter(p);
  if(g.length<60){console.log(`   ${l.padEnd(40)} n=${g.length}`);return;}
  console.log(`   ${l.padEnd(40)} ${(100*g.filter(o=>o.delta-bf(o.b)>0).length/g.length).toFixed(0)}%  (n=${g.length})`);};
console.log(`observations: ${obs.length}\n`);
console.log("Did you end up with the BEST player in the trade?");
rep("got the better player", o=>o.mine!=null&&o.theirs!=null&&o.mine<o.theirs);
rep("gave up the better player", o=>o.mine!=null&&o.theirs!=null&&o.mine>o.theirs);
console.log("\nWhat quality did you acquire?");
rep("acquired a top-24 player", o=>o.mine!=null&&o.mine<=24);
rep("acquired top 25-60", o=>o.mine!=null&&o.mine>24&&o.mine<=60);
rep("acquired top 61-100", o=>o.mine!=null&&o.mine>60&&o.mine<=100);
rep("acquired nothing better than 100", o=>o.mine!=null&&o.mine>100);
rep("acquired no ranked player at all", o=>o.mine==null);
