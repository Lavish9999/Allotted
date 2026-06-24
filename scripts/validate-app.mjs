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

const html = read("www/index.html");
if (html) {
  const checks = [
    ["app mount", '<div id="app"></div>'],
    ["local storage key", 'KEY="budget-app-v1"'],
    ["backup restore", ["function applyBackup", "function restoreText"]],
    ["budget totals", "function totals"],
    ["debt payoff", ["function debtPayoff", "debtPlan"]],
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
  ];

  for (const [label, needles] of checks) {
    hasAny(html, label, needles);
  }

  if (html.includes("fetch(")) fail("Unexpected fetch() call found in local-first app");
  if (/https?:\/\//i.test(html)) fail("Unexpected external URL found in app shell");
  if (/@import/i.test(html)) fail("Unexpected CSS @import found in app shell");
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
