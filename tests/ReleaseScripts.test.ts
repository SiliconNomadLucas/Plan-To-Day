import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const temporaryDirectories: string[] = [];

function createFixture(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-todo-release-"));
  temporaryDirectories.push(directory);
  fs.mkdirSync(path.join(directory, "scripts"));
  fs.copyFileSync(
    path.join(projectRoot, "scripts", "bump-version.mjs"),
    path.join(directory, "scripts", "bump-version.mjs"),
  );
  fs.copyFileSync(
    path.join(projectRoot, "scripts", "validate-release.mjs"),
    path.join(directory, "scripts", "validate-release.mjs"),
  );

  const manifest = {
    id: "obsidian-todo",
    version: "0.1.1",
    minAppVersion: "1.0.0",
  };
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({
    name: "obsidian-todo",
    version: "0.1.1",
    main: "main.js",
  }));
  fs.writeFileSync(path.join(directory, "package-lock.json"), JSON.stringify({
    name: "obsidian-todo",
    version: "0.1.1",
    packages: { "": { name: "obsidian-todo", version: "0.1.1" } },
  }));
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(directory, "versions.json"), JSON.stringify({ "0.1.1": "1.0.0" }));
  for (const filename of ["main.js", "styles.css"]) {
    fs.writeFileSync(path.join(directory, filename), "built artifact");
  }
  return directory;
}

function runScript(directory: string, script: string, args: string[] = [], env = process.env) {
  return spawnSync(
    process.execPath,
    [path.join(directory, "scripts", script), ...args],
    { cwd: directory, encoding: "utf8", env },
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("release scripts", () => {
  it("bumps all package metadata together and rejects non-increasing versions", () => {
    const directory = createFixture();

    const bumped = runScript(directory, "bump-version.mjs", ["0.1.2"]);
    expect(bumped.status).toBe(0);
    for (const filename of ["package.json", "package-lock.json", "manifest.json"]) {
      expect(JSON.parse(fs.readFileSync(path.join(directory, filename), "utf8")).version).toBe("0.1.2");
    }
    expect(JSON.parse(fs.readFileSync(path.join(directory, "versions.json"), "utf8"))["0.1.2"]).toBe("1.0.0");

    const unchanged = runScript(directory, "bump-version.mjs", ["0.1.2"]);
    expect(unchanged.status).not.toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8")).version).toBe("0.1.2");
  });

  it("validates release artifacts and rejects a tag that disagrees with the manifest", () => {
    const directory = createFixture();

    expect(runScript(directory, "validate-release.mjs").status).toBe(0);
    const wrongTag = runScript(directory, "validate-release.mjs", [], {
      ...process.env,
      GITHUB_REF_NAME: "v0.1.2",
    });
    expect(wrongTag.status).not.toBe(0);
    expect(wrongTag.stderr).toContain("does not match manifest version");
  });
});
