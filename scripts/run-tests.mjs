#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const mode = process.argv[2] || "all";
const ignoredSegments = new Set(["node_modules", "dist", ".git", "pydeps", "pydeps_runtime"]);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of entries) {
    if (ignoredSegments.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else if (/\.test\.tsx?$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function toPosixRelative(file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

function isServerTest(file) {
  return file.startsWith("server/") || file.startsWith("tests/");
}

function isFrontendTest(file) {
  return file.startsWith("src/");
}

function isStrollTest(file) {
  return (
    file.startsWith("server/stroll/") ||
    file === "server/db/migrations.test.ts" ||
    file.startsWith("src/ui/home/stroll") ||
    file.startsWith("src/ui/home/Stroll") ||
    file === "src/ui/home/homeNavigation.test.ts" ||
    file === "src/ui/home/HeroCard.test.tsx" ||
    file === "src/ui/home/heroBookmarks.test.ts"
  );
}

const allTests = (await walk(repoRoot)).map(toPosixRelative).sort();
const selected = allTests.filter((file) => {
  if (mode === "all") return true;
  if (mode === "server") return isServerTest(file);
  if (mode === "frontend") return isFrontendTest(file);
  if (mode === "stroll") return isStrollTest(file);
  return false;
});

if (!selected.length) {
  console.log(`No ${mode} tests found.`);
  process.exit(0);
}

const result = spawnSync("npx", ["tsx", "--test", ...selected], {
  cwd: repoRoot,
  shell: process.platform === "win32",
  stdio: "inherit",
});

process.exit(result.status ?? 1);
