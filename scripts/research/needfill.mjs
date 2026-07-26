// Does filling a positional NEED actually help?
//
// need_fill is one of our core archetypes and has never been validated. The
// engine assumes that acquiring at your weakest position beats acquiring at
// your strongest. That is testable now: historical rosters give who a team
// held, and historical values price them, so each team's positional strength
// at the time of the trade can be reconstructed.
//
// RESULT: not validated, and the apparent result is a trap.
//
// The raw gradient looks enormous: buying into a position already above 120%
// of league average beat baseline 64% of the time, buying into one under 60%
// only 38%. That would say the archetype is backwards.
//
// It is circular. Sleeper only serves END OF SEASON rosters, so the player you
// acquired is already counted in that position's strength. "Bought into
// strength" therefore partly means "bought a good player", and acquiring
// quality is already known to predict 60%.
//
// The controlled rows settle it. Holding quality constant at top-60, buying at
// your weakest position beats baseline 57% and at your strongest 56%. No
// difference. Positional need adds nothing once you know how good the player
// is.
//
//   node scripts/research/needfill.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const CACHE="scripts/research/outcomes-cache.json";
const ROSTERS="scripts/research/roster-players.json";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(u,t=3){for(let i=0;i<t;i++){try{const r=await fetch(u);if(r.status===429){await sleep(2000*(i+1));continue;}if(!r.ok)return null;return await r.json();}catch{await sleep(400*(i+1));}}return null;}
async function pool(items,fn,c=6){const o=[];for(let i=0;i<items.length;i+=c){o.push(...await Promise.all(items.slice(i,i+c).map(fn)));await sleep(120);}return o;}

const cache=JSON.parse(readFileSync(CACHE,"utf8"));
const vals=JSON.parse(readFileSync("scripts/research/values-history.json","utf8"));
const trades=Object.values(JSON.parse(readFileSync("scripts/research/trades-with-ids.json","utf8"))).flat();
const played=id=>(cache[id]?.rosters??[]).some(r=>r.pf>0);
const succ={}; for(const [id,v] of Object.entries(cache)) if(v.prev) succ[v.prev]=id;
const measurable=[...new Set(trades.map(t=>t.league))];

let rp=existsSync(ROSTERS)?JSON.parse(readFileSync(ROSTERS,"utf8")):{};
const need=measurable.filter(id=>!rp[id]);
if(need.length){
  console.log(`fetching player lists for ${need.length} leagues`);
  const db=await get("https://api.sleeper.app/v1/players/nfl");
  await pool(need, async id=>{
    const rs=await get(`https://api.sleeper.app/v1/league/${id}/rosters`);
    rp[id]= (rs??[]).map(r=>({rosterId:r.roster_id, players:(r.players??[]).filter(p=>["QB","RB","WR","TE"].includes(db?.[p]?.position)).map(p=>({id:p,pos:db[p].position}))}));
  });
  writeFileSync(ROSTERS,JSON.stringify(rp));
}
console.log(`roster player lists: ${Object.keys(rp).length} leagues\n`);

const shift=(ym,m)=>{const y=Math.floor(ym/100),mm=ym%100+m;return (y+Math.floor((mm-1)/12))*100+((mm-1)%12+1);};
const rankAt=(pid,ym)=>{const h=vals[pid];if(!h)return null;let b=null;for(const [m,e] of h){if(m<=ym)b=e;else break;}return b;};
// Rank -> a value proxy that decays, so top players dominate as they should.
const valOf=r=>r==null?0:Math.max(0, 1000*Math.exp(-r/60));
const rankPct=(l,o)=>{const g=cache[l];if(!g||g.teams<2)return null;const r=g.rosters.find(x=>x.ownerId===o);return r?(r.rank-1)/(g.teams-1):null;};
const ownerOf=(l,r)=>cache[l]?.rosters.find(x=>x.rosterId===r)?.ownerId??null;

const obs=[];
for(const t of trades){
  const n=succ[t.league]; if(!n||!played(t.league)||!played(n)) continue;
  const ym=Number(cache[t.league].season)*100+9;
  const lgRosters=rp[t.league]; if(!lgRosters) continue;
  // League-average positional value, to say what "weak" means relative to peers.
  const perTeam=new Map();
  for(const r of lgRosters){
    const byPos={QB:0,RB:0,WR:0,TE:0};
    for(const p of r.players) byPos[p.pos]+=valOf(rankAt(p.id,ym));
    perTeam.set(r.rosterId,byPos);
  }
  const avg={QB:0,RB:0,WR:0,TE:0};
  for(const b of perTeam.values()) for(const k of Object.keys(avg)) avg[k]+=b[k]/perTeam.size;
  for(const s of t.sides){
    const o=ownerOf(t.league,s.rosterId); if(!o) continue;
    const b=rankPct(t.league,o), a=rankPct(n,o); if(b==null||a==null) continue;
    const mine=perTeam.get(s.rosterId); if(!mine) continue;
    // Relative strength per position, then where did the acquisition land?
    const rel={}; for(const k of Object.keys(avg)) rel[k]= avg[k]>0 ? mine[k]/avg[k] : 1;
    const order=Object.keys(rel).sort((x,y)=>rel[x]-rel[y]);   // weakest first
    const weakest=order[0], strongest=order[3];
    let bestRank=null,bestPos=null;
    for(const p of s.players){const r=rankAt(p.id,ym); if(r!=null&&(bestRank==null||r<bestRank)){bestRank=r;bestPos=p.pos;}}
    if(!bestPos) continue;
    obs.push({b,delta:b-a,bestPos,bestRank,weakest,strongest,relAtBuy:rel[bestPos]});
  }
}
const bk=b=>b<0.25?0:b<0.5?1:b<0.75?2:3;
const base=new Map();
for(const o of obs){const k=bk(o.b);const c=base.get(k)??{n:0,s:0};c.n++;c.s+=o.delta;base.set(k,c);}
const bf=b=>{const v=base.get(bk(b));return v?v.s/v.n:0;};
const rep=(l,p,min=80)=>{const g=obs.filter(p);
  if(g.length<min){console.log(`   ${l.padEnd(46)} n=${g.length}`);return;}
  console.log(`   ${l.padEnd(46)} ${(100*g.filter(o=>o.delta-bf(o.b)>0).length/g.length).toFixed(0)}%  (n=${g.length})`);};

console.log(`observations: ${obs.length}\n`);
console.log("Did acquiring at your WEAKEST position beat acquiring at your strongest?");
rep("bought at my WEAKEST position",   o=>o.bestPos===o.weakest);
rep("bought at my STRONGEST position", o=>o.bestPos===o.strongest);
rep("bought somewhere in the middle",  o=>o.bestPos!==o.weakest&&o.bestPos!==o.strongest);

console.log("\nBy how far below league average that position was");
rep("position was under 60% of league avg", o=>o.relAtBuy<0.6);
rep("position was 60-90% of avg",           o=>o.relAtBuy>=0.6&&o.relAtBuy<0.9);
rep("position was 90-120% of avg",          o=>o.relAtBuy>=0.9&&o.relAtBuy<1.2);
rep("position was over 120% of avg",        o=>o.relAtBuy>=1.2);

console.log("\nDoes filling a need matter MORE when the player is good?");
rep("top-60 player AND at weakest position", o=>o.bestRank<=60&&o.bestPos===o.weakest, 50);
rep("top-60 player at strongest position",   o=>o.bestRank<=60&&o.bestPos===o.strongest, 50);
