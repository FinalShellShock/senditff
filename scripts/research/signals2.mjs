// Hunting for more signal indicators.
//
// Established so far: acquiring quality predicts the outcome (top-24 acquired
// beats baseline 60%, nothing-better-than-100 48%), shape does not, picks do
// not. This looks for indicators we have not tested at all.
//
//   MOMENTUM   was the player rising or falling BEFORE you traded for him?
//              the classic buy-low / sell-high question, and monthly rank
//              history makes it directly measurable
//   POSITION   does what you acquire interact with format (superflex vs 1QB)?
//   BREADTH    does spreading acquisitions across positions beat concentrating?
//
import { readFileSync } from "node:fs";
const cache=JSON.parse(readFileSync("scripts/research/outcomes-cache.json","utf8"));
const vals=JSON.parse(readFileSync("scripts/research/values-history.json","utf8"));
const trades=Object.values(JSON.parse(readFileSync("scripts/research/trades-with-ids.json","utf8"))).flat();
const crawlLg=JSON.parse(readFileSync("scripts/research/trades-crawl.json","utf8")).leagues;
const played=id=>(cache[id]?.rosters??[]).some(r=>r.pf>0);
const succ={}; for(const [id,v] of Object.entries(cache)) if(v.prev) succ[v.prev]=id;
const rankPct=(l,o)=>{const g=cache[l];if(!g||g.teams<2)return null;const r=g.rosters.find(x=>x.ownerId===o);return r?(r.rank-1)/(g.teams-1):null;};
const ownerOf=(l,r)=>cache[l]?.rosters.find(x=>x.rosterId===r)?.ownerId??null;
const shift=(ym,m)=>{const y=Math.floor(ym/100),mm=ym%100+m;return (y+Math.floor((mm-1)/12))*100+((mm-1)%12+1);};
const rankAt=(pid,ym)=>{const h=vals[pid];if(!h)return null;let b=null;for(const [m,e] of h){if(m<=ym)b=e;else break;}return b;};

const obs=[];
for(const t of trades){
  const n=succ[t.league]; if(!n||!played(t.league)||!played(n)) continue;
  const ym=Number(cache[t.league].season)*100+9;
  const sf=crawlLg[t.league]?.superflex ?? false;
  for(const s of t.sides){
    const o=ownerOf(t.league,s.rosterId); if(!o) continue;
    const b=rankPct(t.league,o), a=rankPct(n,o); if(b==null||a==null) continue;
    // Momentum of the BEST player acquired, over the 6 months before the trade.
    let bestRank=null, mom=null, bestPos=null;
    for(const p of s.players){
      const r=rankAt(p.id,ym); if(r==null) continue;
      if(bestRank==null||r<bestRank){
        bestRank=r; bestPos=p.pos;
        const prior=rankAt(p.id,shift(ym,-6));
        mom = prior==null ? null : prior - r;   // positive = rising (rank improved)
      }
    }
    const positions=new Set(s.players.map(p=>p.pos).filter(Boolean));
    obs.push({b,delta:b-a,sf,bestRank,mom,bestPos,breadth:positions.size});
  }
}
const bk=b=>b<0.25?0:b<0.5?1:b<0.75?2:3;
const base=new Map();
for(const o of obs){const k=bk(o.b);const c=base.get(k)??{n:0,s:0};c.n++;c.s+=o.delta;base.set(k,c);}
const bf=b=>{const v=base.get(bk(b));return v?v.s/v.n:0;};
const rep=(l,p,min=80)=>{const g=obs.filter(p);
  if(g.length<min){console.log(`   ${l.padEnd(42)} n=${g.length}`);return;}
  console.log(`   ${l.padEnd(42)} ${(100*g.filter(o=>o.delta-bf(o.b)>0).length/g.length).toFixed(0)}%  (n=${g.length})`);};

console.log(`observations: ${obs.length}\n`);
console.log("MOMENTUM of the best player acquired, 6 months before the trade");
console.log("(rising = his rank had already improved before you bought)");
rep("bought a player who was FALLING (-20 or worse)", o=>o.mom!=null&&o.mom<=-20);
rep("bought a player drifting (-20..+20)",            o=>o.mom!=null&&o.mom>-20&&o.mom<20);
rep("bought a player who was RISING (+20 or more)",   o=>o.mom!=null&&o.mom>=20);

console.log("\nMOMENTUM, holding quality roughly constant (best acquired inside top 60)");
rep("top-60 acquired, had been FALLING", o=>o.bestRank!=null&&o.bestRank<=60&&o.mom!=null&&o.mom<=-20);
rep("top-60 acquired, had been RISING",  o=>o.bestRank!=null&&o.bestRank<=60&&o.mom!=null&&o.mom>=20);

console.log("\nPOSITION of the best player acquired, by format");
for(const [lbl,pred] of [["superflex",o=>o.sf],["1QB",o=>!o.sf]]){
  console.log(`  ${lbl}`);
  for(const pos of ["QB","RB","WR","TE"]) rep(`    acquired a ${pos} as best piece`, o=>pred(o)&&o.bestPos===pos, 60);
}

console.log("\nBREADTH: how many distinct positions did you acquire?");
rep("one position only", o=>o.breadth===1);
rep("two positions",     o=>o.breadth===2);
rep("three or more",     o=>o.breadth>=3);
