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
const withClock = (year, monthIndex, day, fn) => {
  const RealDate = ctx.Date;
  function FakeDate(...args) { return args.length ? new RealDate(...args) : new RealDate(year, monthIndex, day); }
  FakeDate.UTC = RealDate.UTC;
  FakeDate.parse = RealDate.parse;
  FakeDate.now = () => new RealDate(year, monthIndex, day).getTime();
  FakeDate.prototype = RealDate.prototype;
  ctx.Date = FakeDate;
  try { return fn(); }
  finally { ctx.Date = RealDate; }
};

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

  // ---------- Premium tools: behavioral checks ----------
  // Forecast has per-day data and reacts to paying a bill
  run(`var _f1=forecastSeries(14)`);
  check(run("_f1.pts[0].start!==undefined && Array.isArray(_f1.pts[0].bills)"), "forecast produces daily rows (start, bills, end)");
  check(run("typeof _f1.start==='number'"), "forecast reports starting cash");
  check(render("pforecast").includes("Daily forecast") && appEl.innerHTML.includes("Risk day"), "forecast UI shows daily section and risk day");
  run(`var _g0=S.months[mk].groups[0];var _rent=_g0.items.find(i=>i.name==="Rent");payBill(_g0.id,_rent.id)`);
  run(`var _f2=forecastSeries(14)`);
  check(run("_f2.billTotal") < run("_f1.billTotal"), "forecast updates when a bill is marked paid");
  run(`payBill(_g0.id,_rent.id)`); // un-pay Rent to restore state

  // Bill Guard: shortfall flag appears, and clears when the bill is paid
  run(`var _mega=item("Mega Payment",99999,true,+dateKey(addDays(todayLocal(),2)).slice(8,10));_g0.items.push(_mega);commit()`);
  let bg = render("pbills");
  check(bg.includes("may put you short") && bg.includes("Not covered"), "bill guard flags shortfall risk before payday");
  check(/At risk<\/div><div class=money>[1-9]/.test(bg), "at-risk summary counts the risky bill");
  run(`payBill(_g0.id,_mega.id)`);
  bg = render("pbills");
  check(bg.includes("Paid") && !new RegExp('Mega Payment[\\s\\S]{0,400}Mark paid').test(bg), "paid bill shows Paid and loses Mark paid button");
  check(!/may put you short[^<]*<\/b><span[^>]*>[^<]*Mega Payment/.test(bg), "paid bill leaves the at-risk banner");
  run(`_g0.items=_g0.items.filter(i=>i.id!==_mega.id);cloudTombstone("item",_mega.id);commit()`);
  bg = render("pbills");
  check(!bg.includes("may put you short"), "removing the bill clears the shortfall banner (reactive)");
  check(/At risk<\/div><div class=money>0/.test(bg), "at-risk count returns to zero");

  // Bill Guard: bills without due dates are surfaced
  run(`var _nd=item("Mystery Bill",45,true);_nd.dueDay=null;_nd.dueDate="";_g0.items.push(_nd);commit()`);
  check(render("pbills").includes("Needs a due date") && appEl.innerHTML.includes("Mystery Bill"), "bill guard surfaces bills missing due dates");
  run(`_g0.items=_g0.items.filter(i=>i.id!==_nd.id);commit()`);
  const savedForOverdue = run(`JSON.stringify(S)`);
  withClock(2026, 6, 15, () => {
    run(`S=defaultState();mk="2026-07";var _om=blankMonth();_om.income[0].amount=2000;_om.groups[0].items.push(item("Late Rent",800,true,10,"2026-07-10","monthly"));S.months[mk]=_om;S.premium.active=true;S.settings.onboardingCompleted=true;migrate()`);
    bg = render("pbills");
    check(bg.includes("Late Rent") && /Late Rent[\s\S]{0,220}Overdue/.test(bg), "bill guard shows current-month overdue bills");
    check(/Overdue<\/div><div class=money>1/.test(bg), "bill guard overdue summary counts current-month overdue bills");
    check(/Due in 30 days<\/div><div class=money>\$800/.test(bg), "bill guard 30-day total still includes the next monthly occurrence");
  });
  run(`S=JSON.parse(${JSON.stringify(savedForOverdue)});migrate();_g0=S.months[mk].groups[0]`);

  // Subscription Watch: detects recurring transactions across months
  run(`
["2026-03","2026-04"].forEach(k=>{if(!S.months[k]){let mm=blankMonth();S.months[k]=mm}});
[["2026-03","2026-03-08"],["2026-04","2026-04-08"]].forEach(pair=>{
  let it=S.months[pair[0]].groups[1].items;
  if(!it.length)it.push(item("Fun",100));
  it[0].txns.push({id:id(),date:pair[1],amount:15.99,note:"Netflix"});
});commit()`);
  check(run(`subCandidates().some(s=>s.source==="txn"&&s.key==="netflix")`), "subscription watch detects repeated txns across months");
  const subUI = render("psubs");
  check(subUI.includes("Possible subscription") && subUI.includes("Netflix"), "detected subscription labeled in UI");
  run(`setSubStatus("netflix","canceled")`);
  check(run(`subStatusOf("netflix")`) === "canceled", "canceled status persists");
  check(render("psubs").includes("Canceled saved"), "canceled savings summarized");
  run(`setSubStatus("netflix","canceling")`);
  check(render("psubs").includes("Cancel checklist"), "canceling shows cancellation checklist");
  run(`var _subBill=S.months[mk].groups[0].items.find(i=>i.name==="Streaming TV");setSubStatus(_subBill.name.toLowerCase(),"canceled");_subBill.name="Streaming TV Family";var _subRenamed=subCandidates().find(s=>s.name==="Streaming TV Family")`);
  check(run(`subStatusOf(_subRenamed.key,_subRenamed.aliases)`) === "canceled", "bill subscription status survives a bill rename");
  run(`S.months[mk].groups[1].items[0].txns.push({id:id(),date:dateKey(todayLocal()),amount:74.99,note:"Amazon"});commit()`);
  check(!run(`subCandidates().some(s=>s.source==="txn"&&s.key==="amazon")`), "one-off Amazon shopping note is not treated as a subscription");

  // Debt planner: schedule, unpayable warning, avalanche savings on realistic debts
  run(`var _d=debtSim("avalanche",100)`);
  check(run("_d.schedule.length>0 && _d.schedule.length<=12"), "debt sim produces first-12-months schedule");
  check(run("_d.totalPaid>0"), "debt sim reports total paid");
  check(render("debt").includes("First 12 months"), "debt planner shows payment schedule");
  check(appEl.innerHTML.includes("Paid-off minimums are not rolled"), "debt planner states minimum rollover is not automatic");
  run(`var _bad={id:id(),name:"Loan Shark",balance:5000,apr:60,minPayment:10};S.debts.push(_bad);commit()`);
  check(render("debt").includes("may not go down with the current minimum payment"), "unpayable minimum warning shown");
  run(`S.debts=S.debts.filter(d=>d.id!==_bad.id);commit()`);
  run(`var _r1=debtSim("avalanche",50),_r2=debtSim("snowball",50)`);
  check(run("_r1.interest<=_r2.interest"), "avalanche saves interest in realistic example");

  // Weekly review: suggested action responds to the situation
  run(`var _dip=item("Huge Due",99999,true,+dateKey(addDays(todayLocal(),3)).slice(8,10));_g0.items.push(_dip);commit()`);
  check(run(`weeklyAction({out:100,big:null,inAmt:500,leftover:400}).tab`) === "pforecast", "weekly action: forecast dip -> protect bills");
  run(`_g0.items=_g0.items.filter(i=>i.id!==_dip.id);commit()`);
  check(run(`weeklyAction({out:100,big:null,inAmt:800,leftover:700}).tab`) === "debt", "weekly action: leftover + debts -> attack debt");
  run(`var _debts=S.debts;S.debts=[]`);
  check(/savings/i.test(run(`weeklyAction({out:100,big:null,inAmt:800,leftover:700}).body`)), "weekly action: leftover, no debts -> savings");
  run(`S.debts=_debts`);
  check(run(`weeklyAction({out:1000,big:["Shopping",600],inAmt:900,leftover:-100}).title`).includes("Shopping") || run(`weeklyAction({out:1000,big:["Shopping",600],inAmt:900,leftover:-100}).tab`) === "psubs", "weekly action: overweight category or sub audit on overspend");
  const wUI = render("pweekly");
  check(wUI.includes("Biggest transaction") && wUI.includes("Subscriptions paid") && wUI.includes("Vs prior 7 days"), "weekly review shows deep stats");

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
