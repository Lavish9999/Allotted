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

for (const file of requiredFiles) {
  if (!existsSync(file)) fail(`Missing ${file}`);
}

const html = read("www/index.html");
if (html) {
  const checks = [
    ["app mount", '<div id="app"></div>'],
    ["local storage key", 'KEY="budget-app-v1"'],
    ["backup restore", "function applyBackup"],
    ["budget totals", "function totals"],
    ["debt payoff", "function debtPayoff"],
    ["event binding", "function bind()"],
    ["tab events", 'document.querySelectorAll("[data-tab]")'],
    ["file restore listener", 'fileInput").addEventListener("change"'],
    ["settings sheet", "function openSettings"],
    ["privacy sheet", "function openPrivacy"],
  ];

  for (const [label, needle] of checks) {
    if (!html.includes(needle)) fail(`Missing ${label} marker`);
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
  if (!pkg.scripts?.test) fail("package.json missing scripts.test");
  if (!pkg.scripts?.validate) fail("package.json missing scripts.validate");
  if (!pkg.dependencies?.["@capacitor/core"]) fail("package.json missing Capacitor dependency");
}

if (failures) {
  console.error(`\n${failures} validation check(s) failed.`);
  process.exit(1);
}

console.log("Allotted validation passed.");
