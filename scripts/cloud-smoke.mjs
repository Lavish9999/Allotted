// Live Supabase smoke test. Runs ONLY when SUPABASE_URL and SUPABASE_ANON_KEY
// are set (env or .env); otherwise it skips cleanly with exit 0 so CI without
// secrets stays green. Usage: npm run cloud:smoke
//
// What it verifies against the real project:
//   - sign up / sign in / session refresh via www/cloud.js (the actual shipped provider)
//   - personal snapshot push/pull round-trip
//   - household create -> invite code -> second account joins via join_household RPC
//   - shared household scope readable by both members
//   - RLS negatives: user B cannot read user A's personal data; unauthenticated
//     anon requests read zero rows from every table
//
// If email confirmation is ON in your project, throwaway sign-ups can't get a
// session; provide two pre-confirmed test accounts instead:
//   SUPABASE_TEST_EMAIL / SUPABASE_TEST_PASSWORD
//   SUPABASE_TEST_EMAIL2 / SUPABASE_TEST_PASSWORD2
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";

function loadDotEnv() {
  if (!existsSync(".env")) return {};
  const out = {};
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  return out;
}
const env = { ...loadDotEnv(), ...process.env };
const URL0 = (env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const KEY = (env.SUPABASE_ANON_KEY || "").trim();

if (!URL0 || !KEY) {
  console.log("cloud:smoke - SKIPPED (SUPABASE_URL / SUPABASE_ANON_KEY not set). Local suites: npm test && npm run smoke");
  process.exit(0);
}

let fails = 0;
const check = (c, msg) => { if (!c) { fails++; console.error("FAIL:", msg); } else console.log("ok:", msg); };

// Boot the real shipped provider in a minimal window context.
function makeProvider() {
  const store = {};
  const ctx = {
    console, JSON, Date, Math, Promise, Object, Array, String, Number, Buffer,
    fetch: (...a) => fetch(...a),
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
  };
  ctx.window = ctx;
  ctx.window.ALLOTTED_CLOUD_CONFIG = { url: URL0, anonKey: KEY };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL("../www/cloud.js", import.meta.url), "utf8"), ctx);
  if (!ctx.window.AllottedCloud) throw new Error("cloud.js did not initialize with valid config");
  return ctx.window.AllottedCloud;
}

const rand = () => Math.random().toString(36).slice(2, 10);

async function getUser(provider, presetEmail, presetPass) {
  if (presetEmail && presetPass) {
    const r = await provider.signIn(presetEmail, presetPass);
    return { user: r.user, email: presetEmail };
  }
  const email = `allotted-smoke-${rand()}@example.com`;
  const pass = "smoke-" + rand() + "A1";
  try {
    const r = await provider.signUp(email, pass);
    return { user: r.user, email };
  } catch (e) {
    if (/confirm/i.test(e.message)) {
      console.error("cloud:smoke - email confirmation is ON. Set SUPABASE_TEST_EMAIL(2)/SUPABASE_TEST_PASSWORD(2) with pre-confirmed accounts.");
      process.exit(1);
    }
    throw e;
  }
}

const main = async () => {
  const A = makeProvider();
  const B = makeProvider(); // separate token storage = separate device

  // --- auth ---
  const ua = await getUser(A, env.SUPABASE_TEST_EMAIL, env.SUPABASE_TEST_PASSWORD);
  check(!!ua.user?.id, "user A signed up / signed in");
  const sess = await A.getSession();
  check(sess?.user?.id === ua.user.id, "getSession restores user A");
  let badErr = "";
  await A.signIn(ua.email, "definitely-wrong-password").catch((e) => (badErr = e.message));
  check(/incorrect/i.test(badErr), "wrong password -> friendly error");

  // --- personal sync round-trip + premium note: gating is app-side; provider is scope-dumb by design ---
  const scopeA = "user:" + ua.user.id;
  const payload = { months: { "2026-07": { marker: "phase2-" + rand() } }, debts: [], tombstones: [], rows: { bills: [{ id: "i" + rand(), month: "2026-07", name: "Rent", planned: 1400, repeat: "monthly" }], income: [], expenses: [], subscriptions: [], debts: [], notes: [] } };
  await A.push(scopeA, payload);
  const pulled = await A.pull(scopeA);
  check(pulled && JSON.stringify(pulled.payload.months) === JSON.stringify(payload.months), "personal snapshot push/pull round-trip");
  check(typeof pulled.updatedAt === "number" && pulled.updatedAt > 0, "pull returns updatedAt");

  // --- household flow across two accounts ---
  const ub = await getUser(B, env.SUPABASE_TEST_EMAIL2, env.SUPABASE_TEST_PASSWORD2);
  check(!!ub.user?.id && ub.user.id !== ua.user.id, "user B is a distinct account");

  const house = await A.createHousehold(ua.user, "Smoke Household " + rand());
  check(/^[A-Z0-9]{8}$/.test(house.code), "household created with 8-char invite code");
  check(house.members.length === 1 && house.members[0].role === "owner", "creator is owner");

  let joinErr = "";
  await B.joinHousehold(ub.user, "WRONGCOD").catch((e) => (joinErr = e.message));
  check(/not valid|invalid/i.test(joinErr), "bad invite code rejected");

  const joined = await B.joinHousehold(ub.user, house.code);
  check(joined.id === house.id, "user B joined via join_household RPC");
  const fresh = await A.getHousehold(house.id);
  check(fresh.members.length === 2, "member list shows both accounts");

  const scopeH = "house:" + house.id;
  await A.push(scopeH, { months: { "2026-07": { shared: true } }, debts: [], tombstones: [] });
  const sharedB = await B.pull(scopeH);
  check(sharedB && sharedB.payload.months["2026-07"].shared === true, "household scope syncs across accounts");

  // --- RLS negatives ---
  const stolen = await B.pull(scopeA);
  check(stolen === null, "RLS: user B cannot read user A's personal snapshot");
  for (const t of ["profiles", "households", "household_members", "household_invites", "bills", "income", "expenses", "subscriptions", "debts", "notes", "budget_snapshots", "sync_events"]) {
    const r = await fetch(`${URL0}/rest/v1/${t}?select=*&limit=5`, { headers: { apikey: KEY, Authorization: "Bearer " + KEY } });
    const rows = r.ok ? await r.json() : [];
    check(!r.ok || (Array.isArray(rows) && rows.length === 0), `RLS: anonymous request reads zero rows from ${t}`);
  }

  // --- cleanup (best effort) ---
  await B.leaveHousehold(ub.user, house.id).catch(() => {});
  await A.signOut(); await B.signOut();

  console.log(fails ? `\n${fails} FAILURES` : "\nCLOUD SMOKE PASSED (live Supabase)");
  process.exit(fails ? 1 : 0);
};
main().catch((e) => { console.error("cloud:smoke crash:", e.message || e); process.exit(1); });
