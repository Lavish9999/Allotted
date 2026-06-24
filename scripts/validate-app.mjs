import { readFileSync, existsSync } from "node:fs";

const requiredFiles = [
  "www/index.html",
  "www/manifest.webmanifest",
  "capacitor.config.json",
  "codemagic.yaml",
  "package.json",
];

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.error(`FAIL: ${message}`);
};

for (const file of requiredFiles) {
  if (!existsSync(file)) fail(`Missing ${file}`);
}

if (existsSync("www/index.html")) {
  const html = readFileSync("www/index.html", "utf8");
  const checks = [
    ["app mount", '<div id="app"></div>'],
    ["local storage key", 'KEY="budget-app-v1"'],
    ["backup restore", "function applyBackup"],
    ["budget totals", "function totals"],
    ["debt payoff", "function debtPayoff"],
    ["privacy copy", "Your privacy"],
    ["no network fetch", "fetch("],
  ];

  for (const [label, needle] of checks) {
    const present = html.includes(needle);
    if (label === "no network fetch") {
      if (present) fail("Unexpected fetch() call found in local-first app");
    } else if (!present) {
      fail(`Missing ${label} marker`);
    }
  }

  const inlineHandlers = (html.match(/onclick=/g) || []).length;
  if (inlineHandlers < 10) fail("Expected app event wiring markers were not found");
}

if (existsSync("package.json")) {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  if (!pkg.scripts?.test) fail("package.json missing scripts.test");
  if (!pkg.dependencies?.["@capacitor/core"]) fail("package.json missing Capacitor dependency");
}

if (failures) {
  console.error(`\n${failures} validation check(s) failed.`);
  process.exit(1);
}

console.log("Allotted validation passed.");
