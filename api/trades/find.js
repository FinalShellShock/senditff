var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// api/trades/find.ts
var find_exports = {};
__export(find_exports, {
  default: () => handler
});
module.exports = __toCommonJS(find_exports);
var import_crypto = require("crypto");

// api/_lib/admin.ts
var admin = __toESM(require("firebase-admin"));
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env["FIREBASE_SERVICE_ACCOUNT_JSON"] ?? "{}")
    )
  });
  admin.firestore().settings({ ignoreUndefinedProperties: true });
}
var adminAuth = admin.auth();
var adminDb = admin.firestore();

// api/_lib/auth.ts
async function requireApprovedUser(req, res) {
  const authHeader = req.headers["authorization"] ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  let uid;
  let email;
  try {
    const decoded = await adminAuth.verifyIdToken(authHeader.slice(7));
    uid = decoded.uid;
    email = decoded.email ?? "";
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  const userSnap = await adminDb.collection("users").doc(uid).get();
  if (!userSnap.exists || userSnap.data()?.["approved"] !== true) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return { uid, email };
}

// api/trades/find.ts
var MODEL_HAIKU = "claude-haiku-4-5-20251001";
var POSITIONS = ["QB", "RB", "WR", "TE"];
function topPlayersByPos(profile, pos, n = 3) {
  return profile.players.filter((p) => p.position === pos).sort((a, b) => {
    if (b.valueDynasty !== a.valueDynasty) return b.valueDynasty - a.valueDynasty;
    return a.id.localeCompare(b.id);
  }).slice(0, n);
}
function bestGiveFor(mine, targetValue, excludePositions = []) {
  const surplusPos = POSITIONS.filter(
    (p) => mine.positionScores[p].classification === "SURPLUS"
  );
  const candidates = mine.players.filter((p) => !excludePositions.includes(p.position)).sort((a, b) => {
    const aScore = mine.positionScores[a.position]?.urgency ?? 50;
    const bScore = mine.positionScores[b.position]?.urgency ?? 50;
    const aSurplus = surplusPos.includes(a.position) ? 0 : 1;
    const bSurplus = surplusPos.includes(b.position) ? 0 : 1;
    if (aSurplus !== bSurplus) return aSurplus - bSurplus;
    if (aScore !== bScore) return aScore - bScore;
    return b.valueDynasty - a.valueDynasty;
  });
  for (const p of candidates) {
    const ratio = p.valueDynasty / Math.max(1, targetValue);
    if (ratio >= 0.8 && ratio <= 1.25) return [p];
  }
  for (let i = 0; i < Math.min(candidates.length, 8); i++) {
    for (let j = i + 1; j < Math.min(candidates.length, 8); j++) {
      const combined = candidates[i].valueDynasty + candidates[j].valueDynasty;
      const ratio = combined / Math.max(1, targetValue);
      if (ratio >= 0.85 && ratio <= 1.2) return [candidates[i], candidates[j]];
    }
  }
  const best = [...candidates].sort(
    (a, b) => Math.abs(a.valueDynasty - targetValue) - Math.abs(b.valueDynasty - targetValue)
  )[0];
  return best ? [best] : [];
}
function scorePackage(mine, give, receive, archetype) {
  const valueGive = give.reduce((s, p) => s + p.valueDynasty, 0);
  const valueReceive = receive.reduce((s, p) => s + p.valueDynasty, 0);
  const maxVal = Math.max(valueGive, valueReceive, 1);
  const balanceScore = 1 - Math.abs(valueGive - valueReceive) / maxVal;
  const receivePos = receive[0]?.position ?? "QB";
  const posScore = mine.positionScores[receivePos];
  const fillQuality = posScore ? posScore.urgency / 100 : 0.5;
  const archetypeMatch = mine.archetypes.some((a) => a.includes(archetype.split("_")[0])) ? 1 : 0.5;
  return fillQuality * 0.5 + balanceScore * 0.35 + archetypeMatch * 0.15;
}
function generatePackages(mine, allProfiles) {
  const candidates = [];
  const others = allProfiles.filter((p) => p.rosterId !== mine.rosterId);
  const needPositions = POSITIONS.filter(
    (p) => mine.positionScores[p].classification === "CRITICAL_NEED" || mine.positionScores[p].classification === "NEED"
  ).sort((a, b) => mine.positionScores[b].urgency - mine.positionScores[a].urgency);
  for (const needPos of needPositions) {
    for (const them of others) {
      const theirTop = topPlayersByPos(them, needPos, 2);
      for (const target of theirTop) {
        if (target.valueDynasty < 500) continue;
        const give = bestGiveFor(mine, target.valueDynasty, [needPos]);
        if (give.length === 0) continue;
        const valueGive = give.reduce((s, p) => s + p.valueDynasty, 0);
        const archetype = `need_fill_${needPos}`;
        const score = scorePackage(mine, give, [target], archetype);
        candidates.push({
          counterTeam: them.ownerName,
          counterRosterId: them.rosterId,
          give: give.map((p) => ({ id: p.id, name: p.name, position: p.position, valueDynasty: p.valueDynasty })),
          receive: [{ id: target.id, name: target.name, position: target.position, valueDynasty: target.valueDynasty }],
          valueGive,
          valueReceive: target.valueDynasty,
          archetype,
          score
        });
      }
    }
  }
  for (const pos of POSITIONS) {
    if (!mine.archetypes.includes(`tier_down_${pos}`)) continue;
    const myElite = topPlayersByPos(mine, pos, 1)[0];
    if (!myElite) continue;
    for (const them of others) {
      const theirTwo = topPlayersByPos(them, pos, 3).slice(1, 3);
      if (theirTwo.length < 2) continue;
      const combinedReceive = theirTwo.reduce((s, p) => s + p.valueDynasty, 0);
      const ratio = combinedReceive / Math.max(1, myElite.valueDynasty);
      if (ratio < 0.75 || ratio > 1.3) continue;
      const score = scorePackage(mine, [myElite], theirTwo, `tier_down`);
      candidates.push({
        counterTeam: them.ownerName,
        counterRosterId: them.rosterId,
        give: [{ id: myElite.id, name: myElite.name, position: myElite.position, valueDynasty: myElite.valueDynasty }],
        receive: theirTwo.map((p) => ({ id: p.id, name: p.name, position: p.position, valueDynasty: p.valueDynasty })),
        valueGive: myElite.valueDynasty,
        valueReceive: combinedReceive,
        archetype: `tier_down_${pos}`,
        score
      });
    }
  }
  if (mine.windowTier === "SHORT" && mine.competitiveness !== "WEAK") {
    for (const pos of POSITIONS) {
      const myTop = topPlayersByPos(mine, pos, 1)[0];
      if (!myTop || !myTop.age || myTop.age < 28 || myTop.valueDynasty < 1500) continue;
      for (const them of others) {
        if (them.windowTier === "LONG") {
          const theirYouth = them.players.filter((p) => p.position === pos && p.age != null && p.age <= 25).sort((a, b) => b.valueDynasty - a.valueDynasty)[0];
          if (!theirYouth) continue;
          const give = [myTop];
          const receive = [theirYouth];
          const score = scorePackage(mine, give, receive, "age_arb") * 0.9;
          candidates.push({
            counterTeam: them.ownerName,
            counterRosterId: them.rosterId,
            give: give.map((p) => ({ id: p.id, name: p.name, position: p.position, valueDynasty: p.valueDynasty })),
            receive: receive.map((p) => ({ id: p.id, name: p.name, position: p.position, valueDynasty: p.valueDynasty })),
            valueGive: myTop.valueDynasty,
            valueReceive: theirYouth.valueDynasty,
            archetype: "age_arb_sell",
            score
          });
        }
      }
    }
  }
  const byCounter = /* @__PURE__ */ new Map();
  for (const c of candidates) {
    const existing = byCounter.get(c.counterRosterId) ?? [];
    if (existing.length < 2) {
      byCounter.set(c.counterRosterId, [...existing, c]);
    } else if (c.score > Math.min(...existing.map((e) => e.score))) {
      existing.sort((a, b) => a.score - b.score);
      existing[0] = c;
      byCounter.set(c.counterRosterId, existing);
    }
  }
  return Array.from(byCounter.values()).flat().sort((a, b) => b.score - a.score).slice(0, 10).map(({ score: _score, ...pkg }) => pkg);
}
function rationaleHash(pkg, myProfile) {
  const key = JSON.stringify({
    give: pkg.give.map((p) => p.id).sort(),
    receive: pkg.receive.map((p) => p.id).sort(),
    archetype: pkg.archetype,
    myWindow: myProfile.windowLabel
  });
  return (0, import_crypto.createHash)("sha256").update(key).digest("hex");
}
async function generateRationale(pkg, myProfile) {
  const giveNames = pkg.give.map((p) => `${p.name} (${p.position})`).join(", ");
  const receiveNames = pkg.receive.map((p) => `${p.name} (${p.position})`).join(", ");
  const archetypeLabel = pkg.archetype.replace(/_/g, " ");
  const prompt = `You are analyzing a dynasty fantasy football trade for a team classified as ${myProfile.windowLabel} (${myProfile.competitiveness} competitiveness, ${myProfile.windowTier} window).

Trade: Send ${giveNames} and receive ${receiveNames} from ${pkg.counterTeam}.
Trade type: ${archetypeLabel}.

Write 2-3 sentences explaining why this trade makes sense for this team right now. Be specific about the players and the team's situation. Do not use em dashes.`;
  const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env["ANTHROPIC_API_KEY"] ?? "",
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODEL_HAIKU,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!apiRes.ok) return "Rationale unavailable.";
  const data = await apiRes.json();
  return data.content?.[0]?.text?.trim() ?? "Rationale unavailable.";
}
async function addRationale(pkg, myProfile) {
  const hash = rationaleHash(pkg, myProfile);
  const cacheRef = adminDb.collection("rationaleCache").doc(hash);
  const cached = await cacheRef.get();
  if (cached.exists) {
    return { ...pkg, rationale: cached.data()?.["rationale"] };
  }
  const rationale = await generateRationale(pkg, myProfile);
  await cacheRef.set({ hash, rationale, archetype: pkg.archetype, generatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  return { ...pkg, rationale };
}
async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const user = await requireApprovedUser(req, res);
  if (!user) return;
  const { leagueId, rosterId } = req.body;
  if (!leagueId || rosterId == null) {
    return res.status(400).json({ error: "leagueId and rosterId required" });
  }
  try {
    const leagueRef = adminDb.collection("leagues").doc(leagueId);
    const [leagueSnap, profilesSnap] = await Promise.all([
      leagueRef.get(),
      leagueRef.collection("profiles").get()
    ]);
    const members = leagueSnap.data()?.["members"] ?? [];
    if (!members.includes(user.uid)) return res.status(403).json({ error: "Forbidden" });
    const profiles = profilesSnap.docs.map((d) => d.data());
    const myProfile = profiles.find((p) => p.rosterId === Number(rosterId));
    if (!myProfile) return res.status(404).json({ error: "Team not found" });
    const packages = generatePackages(myProfile, profiles);
    const top5 = packages.slice(0, 5);
    const withRationales = await Promise.all(
      top5.map((pkg) => addRationale(pkg, myProfile))
    );
    return res.status(200).json({ packages: withRationales });
  } catch (err) {
    console.error("trades/find error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
