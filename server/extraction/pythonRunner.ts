import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

export async function runPythonJsonScript(scriptName: string, url: string, timeoutMs = 45000): Promise<any | null> {
  const scriptPath = path.resolve(import.meta.dirname, "scripts", scriptName);
  const commands = ["python", "py"];

  for (const cmd of commands) {
    try {
      const args = cmd === "py" ? ["-3", scriptPath, url] : [scriptPath, url];
      const { stdout } = await execFileAsync(cmd, args, { timeout: timeoutMs });
      const raw = String(stdout || "").trim();
      if (!raw) continue;
      return JSON.parse(raw);
    } catch {
      // Try next runtime.
    }
  }

  return null;
}
