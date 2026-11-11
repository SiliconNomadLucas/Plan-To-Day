import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

function readJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(root, filename), "utf8"));
}

function fail(message) {
  console.error(`Release validation failed: ${message}`);
  process.exitCode = 1;
}

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const manifest = readJson("manifest.json");
const versions = readJson("versions.json");

if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version)) {
  fail(`manifest version is not a stable major.minor.patch version: ${manifest.version}`);
}

if (packageJson.name !== manifest.id) {
  fail(`package name (${packageJson.name}) does not match manifest id (${manifest.id})`);
}

if (packageJson.main !== "main.js") {
  fail(`package main entry (${packageJson.main}) must be main.js`);
}

if (packageJson.version !== manifest.version) {
  fail(`package version (${packageJson.version}) does not match manifest version (${manifest.version})`);
}

if (packageLock.version !== packageJson.version || packageLock.packages?.[""]?.version !== packageJson.version) {
  fail(`package-lock.json version does not match ${packageJson.version}`);
}

if (!versions[manifest.version]) {
  fail(`versions.json has no entry for ${manifest.version}`);
} else if (versions[manifest.version] !== manifest.minAppVersion) {
  fail(`versions.json requires Obsidian ${versions[manifest.version]}, manifest requires ${manifest.minAppVersion}`);
}

for (const filename of ["main.js", "manifest.json", "styles.css"]) {
  const artifactPath = path.join(root, filename);
  if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile() || fs.statSync(artifactPath).size === 0) {
    fail(`required release artifact is missing or empty: ${filename}`);
  }
}

const tag = process.env.GITHUB_REF_NAME;
if (tag?.startsWith("v") && tag.slice(1) !== manifest.version) {
  fail(`tag ${tag} does not match manifest version ${manifest.version}`);
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`Release metadata and artifacts are valid for ${manifest.id} ${manifest.version}.`);
