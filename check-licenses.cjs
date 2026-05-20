const fs = require("fs");
const path = require("path");

const packageLockPath = path.join(process.cwd(), "package-lock.json");

if (!fs.existsSync(packageLockPath)) {
  console.error("❌ package-lock.json not found");
  process.exit(1);
}

const lock = JSON.parse(fs.readFileSync(packageLockPath, "utf8"));

const badLicenses = [
  "GPL",
  "AGPL",
  "LGPL",
  "SSPL",
  "BUSL",
  "CPAL",
  "EUPL"
];

const unknown = [];
const flagged = [];

for (const [pkgPath, info] of Object.entries(lock.packages || {})) {
  if (!pkgPath || pkgPath === "") continue;

  const name = info.name || pkgPath.replace(/^node_modules\//, "");
  const version = info.version || "";
  const license = String(info.license || "").trim();

  if (!license) {
    unknown.push({ name, version, license: "UNKNOWN" });
    continue;
  }

  const upper = license.toUpperCase();

  if (badLicenses.some(bad => upper.includes(bad))) {
    flagged.push({ name, version, license });
  }
}

console.log("\nLicense Audit Results");
console.log("=====================");
console.log(`Packages checked: ${Object.keys(lock.packages || {}).length}`);
console.log(`Flagged licenses: ${flagged.length}`);
console.log(`Unknown licenses: ${unknown.length}`);

if (flagged.length) {
  console.log("\n❌ FLAGGED LICENSES:");
  flagged.forEach(p => {
    console.log(`- ${p.name}@${p.version} — ${p.license}`);
  });
}

if (unknown.length) {
  console.log("\n⚠️ UNKNOWN LICENSES:");
  unknown.forEach(p => {
    console.log(`- ${p.name}@${p.version} — ${p.license}`);
  });
}

if (!flagged.length) {
  console.log("\n✅ No GPL/AGPL/LGPL/SSPL/BUSL-style licenses detected.");
}

fs.writeFileSync(
  "licenses.json",
  JSON.stringify({ flagged, unknown }, null, 2)
);

console.log("\nSaved report to licenses.json\n");

if (flagged.length) {
  process.exit(1);
}
