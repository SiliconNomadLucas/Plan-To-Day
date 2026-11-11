import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const nextVersion = process.argv[2];
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function readJson(filename) {
  return {
    data: JSON.parse(fs.readFileSync(path.join(root, filename), "utf8")),
    filename,
    newline: fs.readFileSync(path.join(root, filename), "utf8").includes("\r\n") ? "\r\n" : "\n",
  };
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

if (!semverPattern.test(nextVersion ?? "")) {
  console.error("Usage: npm run version -- <major.minor.patch>");
  process.exit(1);
}

const files = [
  readJson("package.json"),
  readJson("package-lock.json"),
  readJson("manifest.json"),
  readJson("versions.json"),
];
const [packageFile, lockFile, manifestFile, versionsFile] = files;
const currentVersion = manifestFile.data.version;

if (packageFile.data.version !== currentVersion ||
    lockFile.data.version !== currentVersion ||
    lockFile.data.packages?.[""]?.version !== currentVersion) {
  console.error("Cannot bump version: package metadata is inconsistent. Align package.json, package-lock.json, and manifest.json first.");
  process.exit(1);
}

if (compareVersions(nextVersion, currentVersion) <= 0) {
  console.error(`New version ${nextVersion} must be greater than current version ${currentVersion}.`);
  process.exit(1);
}

packageFile.data.version = nextVersion;
lockFile.data.version = nextVersion;
lockFile.data.packages[""].version = nextVersion;
manifestFile.data.version = nextVersion;
versionsFile.data[nextVersion] = manifestFile.data.minAppVersion;

for (const file of files) {
  const contents = JSON.stringify(file.data, null, 2).replace(/\n/g, file.newline) + file.newline;
  fs.writeFileSync(path.join(root, file.filename), contents, "utf8");
}

console.log(`Version updated from ${currentVersion} to ${nextVersion}. Commit the changes, then tag the commit as v${nextVersion}.`);
