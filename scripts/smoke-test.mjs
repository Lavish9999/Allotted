// Allotted smoke tests: boots the real app source with a stubbed DOM and
// exercises free mode, Premium tools, accounts, cloud sync, and household
// sharing end-to-end against the mock cloud provider. Run: npm run smoke
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../www/index.html", import.meta.url), "utf8");
const src = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));

const stubEl = () => ({ onclick: null, onchange: null, innerHTML: "", value: "", dataset: {},
  addEventListener() {}, remove() {}, click() {}, appendChild() {} });
const appEl = stubEl();
const store = {};
const ctx = {
  console, Intl, Date, Math, JSON, Promise, Object, Array, String, Number,
  parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
  setTimeout: () => 0,
  localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
  document: {
    querySelector: (s) => (s === "#app" ? appEl : stubEl()),
    querySelectorAll: () => [],
    getElementById: () => stubEl(),
    createElement: () => stubEl(),
    documentElement: { dataset: {} },
    body: { appendChild() {} },
  },
  navigator: { clipboard: { writeText: async () => {} } },
  confirm: () => true, prompt: () => null, alert: () => {},
  URL: { createObjectURL: () => "blob:x" }, Blob: class {}, FileReader: class { readAsText() {} },
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);

let fails = 0;
const check = (cond, msg) => { if (!cond) { fails++; console.error("FAIL:", msg); } else console.log("ok:", msg); };
const run = (code) => vm.runInContext(code, ctx);
const render = (tab) => { run(`tab=${JSON.stringify(tab)};render()`); return appEl.innerHTML; };
const tick = () => new Promise((r) => setImmediate(r));

// ---------- 1. Local free mode still works ----------
run(`
S=defaultState();
let m=blankMonth(), today=todayLocal();
m.income[0].amount=4200; m.savings[0].amount=300;
m.groups[0].items.push(item("Rent",1400,true,+dateKey(addDays(today,3)).slice(8,10)));
m.groups[0].items.push(item("Streaming TV",15.99,true,+dateKey(addDays(today,10)).slice(8,10)));
m.groups[1].items.push(item("Groceries",500));
m.groups[1].items[0].txns.push({id:id(),date:dateKey(addDays(today,-1)),amount:64,note:"weekly shop"});
m.groups[1].items[0].actual=64;
S.months[mk]=m;
S.settings.onboardingCompleted=true; S.settings.paycheckMode=true;
S.settings.payFrequency="biweekly"; S.settings.nextPayday=dateKey(addDays(today,5));
S.settings.payAmount=2100; S.settings.monthlyIncome=4200; S.settings.savingsGoal=300;
S.debts.push({id:id(),name:"Credit card",balance:2400,apr:24,minPayment:80});
migrate();
`);
for (const t of ["dashboard", "budget", "track", "bills", "more", "debt"])
  check(render(t).length > 200, `free local mode renders ${t}`);
check(run("isPremium()") === false && run("currentUser()") === null, "free mode: no premium, no account, fully local");
check(run("S.cloud.syncEnabled") === false, "cloud sync off by default");

// ---------- 2. Premium screen includes cloud sync + household sharing ----------
const hub = render("premium");
check(hub.includes("Cloud Sync") && hub.includes("Household Sharing"), "premium screen lists Cloud Sync and Household Sharing");
check(hub.includes("$4.99") && hub.includes("$39.99"), "pricing still shown");

// ---------- 3. Sign-in UI renders ----------
const acct = render("account");
check(acct.includes("Sign in") && acct.includes("Create account") && acct.includes("acEmail"), "sign-in UI renders with email/password fields");
check(acct.includes("Forgot password?"), "forgot password placeholder present");
check(render("pcloud").includes("Sample data") && appEl.innerHTML.includes("Unlock Premium"), "free user sees gated Cloud Sync preview");
check(render("phouse").includes("Unlock Premium"), "free user sees gated Household preview");

// ---------- 4. Cloud sync service handles missing config cleanly ----------
check(run("cloudIsMock()") === true, "no bridge + no config -> mock provider (no throw)");
check(run("cloudReady()") === true, "mock provider reports ready");
check(run("SyncService.mode()") === "mock", "sync service reports mock mode");
run("window.ALLOTTED_CLOUD_CONFIG=undefined");
check(run("cloudConfig()") === null && run("typeof SyncService.scope") === "function", "missing config returns null without errors");

const main = async () => {
  // ---------- Accounts flow (mock) ----------
  let err = "";
  await run(`AuthService.signIn("taylor@parkers.home","secret1")`).catch((e) => (err = e.message));
  check(/incorrect/i.test(err), "sign-in before sign-up rejects cleanly");
  await run(`AuthService.signUp("taylor@parkers.home","secret1")`);
  check(run("currentUser().email") === "taylor@parkers.home", "sign up creates session");
  check(!JSON.stringify(run("JSON.parse(backupPayload())")).includes("allotted-session"), "backups do not contain session data");
  check(render("account").includes("Signed in"), "account status UI shows signed in");

  // ---------- Premium + cloud sync ----------
  run(`SubscriptionManager.purchase("yearly")`);
  check(run("isPremium()") === true, "mock premium purchase");
  check(run("SyncService.enable()") === true, "premium + signed in can enable sync");
  await tick(); await tick();
  check(run("S.cloud.syncEnabled") === true && run("S.cloud.lastSyncedAt") > 0, "sync now sets lastSyncedAt");
  check(run("S.cloud.syncStatus") === "ok", "sync status ok");
  const cloudUI = render("pcloud");
  check(cloudUI.includes("Backed up") && cloudUI.includes("Sync now") && cloudUI.includes("Last synced"), "cloud sync screen shows status, last synced, sync now");
  run(`commit()`);
  check(run("S.cloud.syncStatus") === "pending", "local edit marks changes-not-synced");

  // ---------- Household create + partner join via invite code ----------
  await run(`HouseholdService.create("The Parkers")`);
  const code = run("S.cloud.household.inviteCode");
  check(/^[A-Z0-9]{8}$/.test(code), "household created with 8-char invite code");
  check(render("phouse").includes("The Parkers") && appEl.innerHTML.includes(code), "household invite UI renders with code");
  await run(`SyncService.syncNow()`); // push household scope snapshot

  // partner on "another device": sign out, sign up, join with code
  await run(`AuthService.signOut()`);
  check(run("currentUser()") === null, "sign out clears session");
  await run(`AuthService.signUp("alex@parkers.home","secret2")`);
  run(`S.premium.active=true`); // partner premium (test)
  let badErr = "";
  await run(`HouseholdService.join("WRONGCOD")`).catch((e) => (badErr = e.message));
  check(/not valid/i.test(badErr), "bad invite code rejected with clear error");
  await run(`HouseholdService.join(${JSON.stringify(code)})`);
  check(run("S.cloud.household.members.length") === 2, "partner joined - household has 2 members");
  check(run("S.cloud.household.role") === "member", "partner role is member");
  const houseUI = render("phouse");
  check(houseUI.includes("taylor@parkers.home") && houseUI.includes("alex@parkers.home"), "member list shows both partners");

  // shared scope sync pulls owner's budget to partner
  run("S.months={};S.debts=[];migrate()"); // partner starts empty
  await run(`SyncService.syncNow()`);
  check(Object.keys(run("S.months")).length >= 1 && run("S.debts.length") >= 1, "partner pulled shared household budget");
  check(run(`JSON.stringify(S.months).includes("Rent")`), "shared bills arrived");

  // attribution stamps
  check(run("S.months[Object.keys(S.months)[0]].groups[0].items[0].createdAt") > 0, "items carry createdAt/updatedAt stamps");
  const rows = run("MigrationService.exportRows()");
  check(rows.bills.length >= 1 && rows.expenses.length >= 1 && rows.debts.length >= 1, "migration service exports normalized rows");
  check(rows.bills[0].householdId === run("S.cloud.household.id"), "exported rows carry householdId");

  // ---------- Conflict-safe merge unit checks ----------
  run(`
var A={months:{"2026-07":{income:[],savings:[],groups:[{id:"g1",name:"Bills",items:[{id:"i1",name:"Rent",planned:1400,actual:0,txns:[],recurring:true,updatedAt:100}]}]}},debts:[]};
var B={months:{"2026-07":{income:[],savings:[],groups:[{id:"g1",name:"Bills",items:[{id:"i1",name:"Rent (edited)",planned:1450,actual:0,txns:[],recurring:true,updatedAt:200},{id:"i2",name:"Water",planned:60,actual:0,txns:[],recurring:true,updatedAt:150}]}]}},debts:[]};
var M1=mergeCloudStates(A,B,[]);
var M2=mergeCloudStates(B,A,[]);
var M3=mergeCloudStates(A,B,[{t:"item",id:"i2",at:1}]);
`);
  check(run(`M1.state.months["2026-07"].groups[0].items.find(i=>i.id==="i1").planned`) === 1450, "merge: newer remote wins by updatedAt");
  check(run(`M2.state.months["2026-07"].groups[0].items.find(i=>i.id==="i1").planned`) === 1450, "merge: newer local preserved (not lost)");
  check(run(`M1.state.months["2026-07"].groups[0].items.length`) === 2, "merge: remote-only item added");
  check(run(`M3.state.months["2026-07"].groups[0].items.some(i=>i.id==="i2")`) === false, "merge: tombstoned item stays deleted");
  check(run("M1.notices.length") >= 1, "merge: conflict produces a visible notice");

  // ---------- Sync error state ----------
  run(`S.premium.active=false`);
  await run(`SyncService.syncNow()`);
  check(run("S.cloud.syncStatus") === "error" && /premium/i.test(run("S.cloud.lastError")), "sync without premium -> clean error state");
  run(`S.premium.active=true`);

  // ---------- Premium enforcement at the service level ----------
  run(`S.premium.active=false`);
  let gateErr = "";
  await run(`HouseholdService.create("Nope")`).catch((e) => (gateErr = e.message));
  check(/premium/i.test(gateErr), "signed-in free user cannot create household (service-level gate)");
  gateErr = "";
  await run(`HouseholdService.join("ABCD2345")`).catch((e) => (gateErr = e.message));
  check(/premium/i.test(gateErr), "signed-in free user cannot join household (service-level gate)");
  check(run("SyncService.enable()") === false, "signed-in free user cannot enable sync");
  run(`S.premium.active=true`);

  // ---------- www/cloud.js provider boundary (no network, no keys) ----------
  const cloudSrc = readFileSync(new URL("../www/cloud.js", import.meta.url), "utf8");
  const makeCloudCtx = (config, fetchImpl) => {
    const st = {};
    const c = { console, JSON, Date, Math, Promise, Object, Array, String, Number,
      localStorage: { getItem: (k) => st[k] ?? null, setItem: (k, v) => { st[k] = v; }, removeItem: (k) => { delete st[k]; } } };
    c.window = c;
    if (config) c.window.ALLOTTED_CLOUD_CONFIG = config;
    if (fetchImpl) c.fetch = fetchImpl;
    vm.createContext(c);
    vm.runInContext(cloudSrc, c);
    return c;
  };

  // 1) No config -> cloud.js defines nothing -> app stays on MockCloud
  const c1 = makeCloudCtx(null);
  check(c1.window.AllottedCloud === undefined, "cloud.js without config defines no bridge (mock fallback)");
  const c1b = makeCloudCtx({ url: "", anonKey: "" });
  check(c1b.window.AllottedCloud === undefined, "cloud.js with empty config defines no bridge");
  check(run("cloudIsMock()") === true, "app provider resolution stays mock without a bridge");

  // 2) With config + stubbed fetch: verify Supabase v2 call shapes, isolated in cloud.js
  const calls = [];
  const okJson = (obj) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(obj)) });
  const fakeFetch = (url, opts) => {
    calls.push({ url, opts });
    if (url.includes("/auth/v1/token?grant_type=password"))
      return okJson({ access_token: "at1", refresh_token: "rt1", expires_in: 3600, user: { id: "uid-1", email: "a@b.co" } });
    if (url.includes("/auth/v1/signup"))
      return okJson({ access_token: "at2", refresh_token: "rt2", expires_in: 3600, user: { id: "uid-2", email: "c@d.co" } });
    if (url.includes("/budget_snapshots?scope=eq."))
      return okJson([{ payload: { months: {} }, updated_at: new Date().toISOString() }]);
    return okJson([]);
  };
  const c2 = makeCloudCtx({ url: "stub-project.invalid", anonKey: "anon-key-stub" }, fakeFetch);
  check(!!c2.window.AllottedCloud && c2.window.AllottedCloud.name === "supabase", "cloud.js with config defines AllottedCloud");
  const u1 = await c2.window.AllottedCloud.signIn("a@b.co", "pw123456");
  check(u1.user.id === "uid-1", "signInWithPassword flow returns user");
  check(calls.some((c) => c.url.includes("/auth/v1/token?grant_type=password")), "sign-in hits GoTrue password grant");
  await c2.window.AllottedCloud.push("user:uid-1", { months: {}, debts: [], rows: null });
  const pushCall = calls.find((c) => c.url.includes("/budget_snapshots") && c.opts.method === "POST");
  check(!!pushCall && pushCall.opts.headers.Authorization === "Bearer at1", "push upserts snapshot with user bearer token");
  check(pushCall.opts.headers.apikey === "anon-key-stub", "requests carry anon key only");
  const pulled = await c2.window.AllottedCloud.pull("user:uid-1");
  check(pulled && typeof pulled.updatedAt === "number", "pull parses snapshot + updatedAt");

  // 3) Offline / failed fetch -> clean error, not a crash
  const c3 = makeCloudCtx({ url: "stub.invalid", anonKey: "k" }, () => Promise.reject(new TypeError("Failed to fetch")));
  let offErr = "";
  await c3.window.AllottedCloud.signIn("a@b.co", "x").catch((e) => (offErr = e.message));
  check(/offline/i.test(offErr), "network failure maps to friendly offline error");

  // 4) No session -> authed calls fail with clear message instead of leaking anon writes
  const c4 = makeCloudCtx({ url: "stub.invalid", anonKey: "k" }, fakeFetch);
  let sessErr = "";
  await c4.window.AllottedCloud.push("user:x", {}).catch((e) => (sessErr = e.message));
  check(/session|sign in/i.test(sessErr), "push without session demands sign-in");

  // ---------- Legacy backup (schema 11, no cloud) restores clean ----------
  run(`var _bk=JSON.parse(backupPayload()); delete _bk.cloud; _bk.schemaVersion=11; S=defaultState(); adoptState(_bk); migrate();`);
  check(run("S.cloud && S.cloud.syncEnabled===false"), "legacy backup restores with fresh cloud defaults");
  check(render("dashboard").length > 200, "renders after legacy restore");

  console.log(fails ? `\n${fails} FAILURES` : "\nALL SMOKE CHECKS PASSED");
  process.exit(fails ? 1 : 0);
};
main().catch((e) => { console.error("SMOKE CRASH:", e); process.exit(1); });
