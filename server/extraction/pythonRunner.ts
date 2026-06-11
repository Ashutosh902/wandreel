import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_RUNTIME_PYDEPS_DIR = path.join(os.tmpdir(), "wandreel-layer1-pydeps");

type RuntimeProfile = "instagram" | "youtube" | "media" | "ocr" | "whisper";

const SCRIPT_RUNTIME_PROFILES: Partial<Record<string, RuntimeProfile>> = {
  "fetch_instagram_metadata.py": "instagram",
  "fetch_youtube_metadata.py": "youtube",
  "fetch_youtube_transcript.py": "youtube",
  "fetch_video_frames.py": "media",
  "fetch_ocr_text.py": "ocr",
  "fetch_media_whisper.py": "whisper",
  "fetch_youtube_whisper.py": "whisper",
};

const PROFILE_REQUIREMENTS: Record<RuntimeProfile, string> = {
  instagram: "requirements.instagram.txt",
  youtube: "requirements.youtube.txt",
  media: "requirements.media.txt",
  ocr: "requirements.ocr.txt",
  whisper: "requirements.whisper.txt",
};

const bootstrapPromises = new Map<string, Promise<boolean>>();

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

function isBootstrapEnabled(): boolean {
  const raw = String(process.env.LAYER1_AUTO_BOOTSTRAP_PYDEPS || "").trim().toLowerCase();
  return !["0", "false", "no"].includes(raw);
}

function getRuntimePydepsPath(): string {
  return process.env.LAYER1_PYDEPS_PATH?.trim() || process.env.LAYER1_RUNTIME_PYDEPS_DIR?.trim() || DEFAULT_RUNTIME_PYDEPS_DIR;
}

function buildPythonEnv(pydepsPath: string) {
  return {
    ...process.env,
    PYTHONUNBUFFERED: "1",
    LAYER1_PYDEPS_PATH: pydepsPath,
  };
}

async function executePythonScript(scriptPath: string, url: string, timeoutMs: number, pydepsPath: string): Promise<any | null> {
  const commands = ["python", "py"];
  let lastError: unknown = null;

  for (const cmd of commands) {
    try {
      const args = cmd === "py" ? ["-3", scriptPath, url] : [scriptPath, url];
      const { stdout } = await execFileAsync(cmd, args, {
        timeout: timeoutMs,
        env: buildPythonEnv(pydepsPath),
      });
      const raw = String(stdout || "").trim();
      if (!raw) continue;
      return parseJsonFromPythonStdout(raw);
    } catch (error) {
      lastError = error;
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

function shouldBootstrapRuntime(scriptName: string, result: any | null): result is Record<string, unknown> {
  if (!isBootstrapEnabled()) return false;
  if (!SCRIPT_RUNTIME_PROFILES[scriptName]) return false;
  if (!result || typeof result !== "object") return false;

  const error = String((result as { error?: unknown }).error || "").trim();
  const stderr = String((result as { stderr?: unknown }).stderr || "").trim();
  const combined = `${error}\n${stderr}`.toLowerCase();

  return (
    combined.includes("missing_") ||
    combined.includes("ffmpeg_not_available") ||
    combined.includes("no module named") ||
    combined.includes("pip") && combined.includes("module")
  );
}

async function ensureRuntimeProfileInstalled(profile: RuntimeProfile, pydepsPath: string): Promise<boolean> {
  const requirementFile = path.resolve(import.meta.dirname, "requirements", PROFILE_REQUIREMENTS[profile]);
  const cacheKey = `${profile}:${pydepsPath}`;
  const existing = bootstrapPromises.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    const commands = ["python", "py"];
    let lastError: unknown = null;

    for (const cmd of commands) {
      try {
        const args =
          cmd === "py"
            ? ["-3", "-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--upgrade", "--target", pydepsPath, "-r", requirementFile]
            : ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--upgrade", "--target", pydepsPath, "-r", requirementFile];
        await execFileAsync(cmd, args, {
          timeout: DEFAULT_BOOTSTRAP_TIMEOUT_MS,
          env: buildPythonEnv(pydepsPath),
        });
        return true;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      console.warn("[python-runtime-bootstrap] install_failed", {
        profile,
        pydepsPath,
        error: lastError instanceof Error ? lastError.message : String(lastError),
      });
    }
    return false;
  })();

  bootstrapPromises.set(cacheKey, promise);
  const ok = await promise;
  if (!ok) bootstrapPromises.delete(cacheKey);
  return ok;
}

export async function runPythonJsonScript(scriptName: string, url: string, timeoutMs = 45000): Promise<any | null> {
  const scriptPath = path.resolve(import.meta.dirname, "scripts", scriptName);
  const configuredPydepsPath = getRuntimePydepsPath();
  const firstAttempt = await executePythonScript(scriptPath, url, timeoutMs, configuredPydepsPath);

  if (!shouldBootstrapRuntime(scriptName, firstAttempt)) {
    return firstAttempt;
  }

  const profile = SCRIPT_RUNTIME_PROFILES[scriptName];
  if (!profile) return firstAttempt;

  const installed = await ensureRuntimeProfileInstalled(profile, configuredPydepsPath);
  if (!installed) return firstAttempt;

  return executePythonScript(scriptPath, url, timeoutMs, configuredPydepsPath);
}
