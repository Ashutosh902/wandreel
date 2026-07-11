#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const commands = [
  ["npm", ["run", "lint"]],
  ["npm", ["run", "typecheck:server"]],
  ["npm", ["test"]],
  ["npm", ["run", "test:e2e"]],
  ["npm", ["run", "build"]],
];

for (const [command, args] of commands) {
  const label = `${command} ${args.join(" ")}`;
  console.log(`\n[release-verify] ${label}`);
  const result = process.platform === "win32"
    ? spawnSync(label, { shell: true, stdio: "inherit" })
    : spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`[release-verify] failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

console.log("\n[release-verify] all gates passed");
