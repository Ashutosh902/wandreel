import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

function parseJsonFromPythonStdout(raw: string): any | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith("{") && !line.startsWith("[")) continue;
    try {
      return JSON.parse(line);
    } catch {
      continue;
    }
  }

  return JSON.parse(trimmed);
}

export async function runPythonJsonScript(scriptName: string, url: string, timeoutMs = 45000): Promise<any | null> {
  const scriptPath = path.resolve(import.meta.dirname, "scripts", scriptName);
  const runtimePydepsPath = path.resolve(import.meta.dirname, "pydeps_runtime");
  const configuredPydepsPath = process.env.LAYER1_PYDEPS_PATH?.trim() || runtimePydepsPath;
  const commands = ["python", "py"];
  let lastError: unknown = null;

  for (const cmd of commands) {
    try {
      const args = cmd === "py" ? ["-3", scriptPath, url] : [scriptPath, url];
      const { stdout } = await execFileAsync(cmd, args, {
        timeout: timeoutMs,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
          LAYER1_PYDEPS_PATH: configuredPydepsPath,
        },
      });
      const raw = String(stdout || "").trim();
      if (!raw) continue;
      return parseJsonFromPythonStdout(raw);
    } catch (error) {
      lastError = error;
      // Try next runtime.
    }
  }

  if (lastError && typeof lastError === "object" && "message" in lastError) {
    const stderr =
      "stderr" in lastError && typeof (lastError as { stderr?: unknown }).stderr === "string"
        ? String((lastError as { stderr?: unknown }).stderr || "").trim()
        : "";
    return {
      ok: false,
      error: String((lastError as { message?: unknown }).message || "python_runtime_failed"),
      stderr: stderr || undefined,
    };
  }
  return null;
}
