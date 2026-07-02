import { readFileSync, existsSync } from "node:fs";

const requiredFiles = [
  "www/index.html",
  "www/manifest.webmanifest",
  "www/privacy.html",
  "www/support.html",
  "resources/icon.png",
  "capacitor.config.json",
  "codemagic.yaml",
  "package.json",
  "docs/supabase-schema.sql",
  "docs/cloud-accounts.md",
  ".env.example",
  "www/cloud-config.example.js",
  "www/cloud.js",
  "scripts/write-cloud-config.mjs",
];

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.error(`FAIL: ${message}`);
};

const read = (file) => existsSync(file) ? readFileSync(file, "utf8") : "";
const hasAny = (text, label, needles) => {
  const options = Array.isArray(needles) ? needles : [needles];
  if (!options.some((needle) => text.includes(needle))) {
    fail(`Missing ${label} marker`);
  }
};

for (const file of requiredFiles) {
  if (!existsSync(file)) fail(`Missing ${file}`);
}

if (existsSync("scripts/apply-index-fixes.mjs")) {
  fail("Build-time index patcher must not exist. www/index.html must be the source of truth.");
}

// Generated local files may exist (npm run cloud:config creates one before
// builds) but must never be trackable: they hold project keys.
const gitignore = read(".gitignore");
if (!gitignore.includes("www/cloud-config.js")) fail(".gitignore must ignore www/cloud-config.js");
if (!gitignore.includes(".env")) fail(".gitignore must ignore .env");
if (existsSync("www/cloud-config.js")) {
  const localCfg = read("www/cloud-config.js");
  if (/service_role/i.test(localCfg)) fail("Local www/cloud-config.js contains a service_role reference - regenerate with the anon key");
}

const html = read("www/index.html");
if (html) {
  const checks = [
    ["app mount", '<div id="app"></div>'],
    ["local storage key", 'KEY="budget-app-v1"'],
    ["backup restore", ["function applyBackup", "function restoreText"]],
    ["budget totals", "function totals"],
    ["debt payoff", ["function debtPayoff", "debtPlan"]],
    ["debt payoff runaway guard", ["unpayable", "Payment needs review"]],
    ["event binding", "function bind()"],
    ["tab events", 'document.querySelectorAll("[data-tab]")'],
    ["file restore listener", ['fileInput").addEventListener("change"', '$("#fileInput").onchange', 'document.getElementById("fileInput").addEventListener("change"']],
    ["settings entry", ["function openSettings", "settingsBtn"]],
    ["privacy copy", ["function openPrivacy", "privacy.html", "Allotted uses device storage"]],
    ["storage failure flag", ["storageBroken", "broken"]],
    ["storage failure warning", ["storageWarning", "warning"]],
    ["safe startup save", ["if(!storageBroken)save();render();", "if(!broken)save();render();"]],
    ["month carry-forward helper", ["function selectMonth", "function navMonth"]],
    ["selected-month bill status", ["function billStatus", "function billState"]],
    ["paycheck safe-to-spend", ["function safeUntilPayday", "nextPayday"]],
    ["restore replaces state", ["S=defaultState();adoptState(d);migrate();", "S=base();adopt(d);migrate();"]],
    ["restore confirmation", "Restore this backup and replace"],
    ["destructive action confirmation", ['confirm("Clear all transactions', 'confirm("Clear "+monthName']],
    ["nonnegative numeric clamp", ["const money=v=>", "cash=v=>"]],
    ["bills primary nav", ["['bills','Bills']", '["bills","Bills"]']],
    ["transaction edit row", ["data-edittxn", "data-txn"]],
    ["transaction edit handler", ["openTxn(b.dataset.edittxn)", "openTxn(b.dataset.txn)"]],
    ["transaction delete affordance", "Delete transaction"],
    ["transaction recalculation", ["function recalcItem", "function recalc"]],
    ["backup reminder", ["function backupReminder", "Last backup:"]],
    ["premium state default", ["function defaultPremium"]],
    ["premium flag helper", ["function isPremium"]],
    ["reusable premium gate", ["function premiumGate"]],
    ["subscription manager", ["SubscriptionManager"]],
    ["monthly product id", ["allotted.premium.monthly"]],
    ["yearly product id", ["allotted.premium.yearly"]],
    ["restore purchases affordance", ["pRestore"]],
    ["premium hub screen", ["function premium()"]],
    ["cash flow forecast", ["function forecastSeries"]],
    ["bill guard", ["function pBillguardFull"]],
    ["subscription watch", ["function subCandidates"]],
    ["weekly money review", ["function pWeeklyFull"]],
    ["daily forecast rows", ["Daily forecast"]],
    ["bill coverage risk", ["Not covered"]],
    ["subscription txn detection", ["function detectTxnSubs"]],
    ["debt payment schedule", ["First 12 months"]],
    ["debt planner comparison", ["function debtSim"]],
    ["account screen", ["function account()"]],
    ["auth service", ["const AuthService"]],
    ["cloud sync service", ["const SyncService"]],
    ["household service", ["const HouseholdService"]],
    ["invite code service", ["const InviteService"]],
    ["migration export service", ["const MigrationService"]],
    ["mock cloud provider", ["const MockCloud"]],
    ["cloud sync screen", ["function pCloudFull"]],
    ["household sharing screen", ["function pHouseFull"]],
    ["conflict-safe merge", ["function mergeCloudStates"]],
    ["cloud state default", ["function defaultCloud"]],
    ["session stored outside backups", ["allotted-session-v1"]],
    ["provider script tags", ["<script src=\"cloud.js\">"]],
  ];

  for (const [label, needles] of checks) {
    hasAny(html, label, needles);
  }

  if (html.includes("fetch(")) fail("Unexpected fetch() call found in local-first app");
  if (/https?:\/\//i.test(html)) fail("Unexpected external URL found in app shell");
  if (/@import/i.test(html)) fail("Unexpected CSS @import found in app shell");
  const cfgExample = read("www/cloud-config.example.js");
  const cloudjs = read("www/cloud.js");
  if (/eyJ[A-Za-z0-9_-]{24,}/.test(html + cfgExample + cloudjs)) fail("Possible real Supabase key committed in app files");
  if (/service_role/i.test(html + cfgExample + cloudjs)) fail("service_role must never appear in app files");
  if (cloudjs) {
    if (!cloudjs.includes("window.AllottedCloud")) fail("cloud.js must define the AllottedCloud provider bridge");
    if (!cloudjs.includes("ALLOTTED_CLOUD_CONFIG")) fail("cloud.js must no-op without cloud config (mock fallback)");
    if (!cloudjs.includes("grant_type=password")) fail("cloud.js missing signInWithPassword flow");
    if (!cloudjs.includes("rpc/join_household")) fail("cloud.js must join households via the secure join_household RPC");
    if (!cloudjs.includes("/auth/v1/recover")) fail("cloud.js missing password reset flow");
  }
  if (html.includes("supabase.co") || html.includes("createClient(")) fail("Supabase calls must stay isolated in www/cloud.js");
}

const support = read("www/support.html");
if (support) {
  if (!support.includes("mailto:getallotted@gmail.com")) fail("Support page missing real mailto contact");
  if (/your preferred|your-email|example\.com|add your/i.test(support)) fail("Support page still contains placeholder wording");
}

const privacy = read("www/privacy.html");
if (privacy) {
  if (!privacy.includes("getallotted@gmail.com")) fail("Privacy page missing support contact");
  if (!privacy.includes("bills, debts")) fail("Privacy page should mention bills and debts data");
  if (/your-email|example\.com/i.test(privacy)) fail("Privacy page still contains placeholder contact");
}

const manifest = read("www/manifest.webmanifest");
if (manifest) {
  try {
    const parsed = JSON.parse(manifest);
    if (parsed.name !== "Allotted") fail("Manifest name should be Allotted");
    if (parsed.display !== "standalone") fail("Manifest display should be standalone");
    if (!Array.isArray(parsed.icons) || parsed.icons.length < 2) fail("Manifest should include app icons");
  } catch {
    fail("Manifest is not valid JSON");
  }
}

const pkgText = read("package.json");
if (pkgText) {
  const pkg = JSON.parse(pkgText);
  if (pkg.scripts?.["fix:index"]) fail("package.json must not expose fix:index");
  if (pkg.scripts?.test !== "node scripts/validate-app.mjs") fail("test script should validate committed source directly");
  if (pkg.scripts?.validate !== "node scripts/validate-app.mjs") fail("validate script should run validation directly");
  if (!pkg.dependencies?.["@capacitor/core"]) fail("package.json missing Capacitor dependency");
  for (const section of ["dependencies", "devDependencies"]) {
    for (const [name, version] of Object.entries(pkg[section] || {})) {
      if (/^[~^]/.test(version)) fail(`${name} should be pinned exactly, not ${version}`);
    }
  }
}

const codemagic = read("codemagic.yaml");
if (codemagic) {
  if (codemagic.includes("Apply app fixes")) fail("Codemagic must not patch app source during build");
  if (!codemagic.includes("Validate committed app source")) fail("Codemagic should validate committed app source");
  if (!/xcode:\s*26\.4/.test(codemagic)) fail("Codemagic Xcode version should be pinned");
  if (!codemagic.includes("submit_to_app_store: false")) fail("Codemagic should not auto-submit to App Store");
}

if (failures) {
  console.error(`\n${failures} validation check(s) failed.`);
  process.exit(1);
}

console.log("Allotted validation passed.");
