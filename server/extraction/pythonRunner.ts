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

const PROFILE_MODULE_CHECKS: Record<RuntimeProfile, string[]> = {
  instagram: ["instaloader"],
  youtube: ["yt_dlp", "youtube_transcript_api"],
  media: ["yt_dlp", "imageio_ffmpeg"],
  ocr: ["yt_dlp", "imageio_ffmpeg", "instaloader", "PIL", "pytesseract"],
  whisper: ["yt_dlp", "imageio_ffmpeg", "faster_whisper"],
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

export function getConfiguredRuntimePydepsPath(): string {
  return getRuntimePydepsPath();
}

function buildPythonEnv(pydepsPath: string) {
  return {
    ...process.env,
    PYTHONUNBUFFERED: "1",
    LAYER1_PYDEPS_PATH: pydepsPath,
  };
}

function shortPreview(value: string | undefined, maxLines = 4): string | undefined {
  const trimmed = String(value || "").trim();
  if (!trimmed) return undefined;
  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .join("\n");
}

async function executePythonScript(scriptPath: string, args: string[], timeoutMs: number, pydepsPath: string): Promise<any | null> {
  const commands = ["python", "py"];
  let lastError: unknown = null;

  for (const cmd of commands) {
    try {
      const commandArgs = cmd === "py" ? ["-3", scriptPath, ...args] : [scriptPath, ...args];
      const { stdout } = await execFileAsync(cmd, commandArgs, {
        timeout: timeoutMs,
        env: buildPythonEnv(pydepsPath),
        maxBuffer: 20 * 1024 * 1024,
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
    const exitCode =
      "code" in lastError && (typeof (lastError as { code?: unknown }).code === "number" || typeof (lastError as { code?: unknown }).code === "string")
        ? (lastError as { code?: number | string }).code ?? null
        : null;
    console.warn("[python-script-failed]", {
      scriptPath,
      exitCode,
      stderrShortPreview: shortPreview(stderr),
      error: String((lastError as { message?: unknown }).message || "python_runtime_failed"),
    });
    return {
      ok: false,
      error: String((lastError as { message?: unknown }).message || "python_runtime_failed"),
      exitCode,
      stderr: stderr || undefined,
      stderrShortPreview: shortPreview(stderr),
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
  if (await isRuntimeProfileAvailable(profile, pydepsPath)) {
    return true;
  }

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
          maxBuffer: 20 * 1024 * 1024,
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

async function isRuntimeProfileAvailable(profile: RuntimeProfile, pydepsPath: string): Promise<boolean> {
  const modules = PROFILE_MODULE_CHECKS[profile] || [];
  if (!modules.length) return false;

  const probeScript = [
    "import importlib.util, json, sys",
    `sys.path.insert(0, r'''${pydepsPath.replace(/'/g, "''")}''')`,
    `modules = ${JSON.stringify(modules)}`,
    "missing = [name for name in modules if importlib.util.find_spec(name) is None]",
    "print(json.dumps({'ok': len(missing) == 0, 'missing': missing}))",
  ].join("; ");

  const commands = ["python", "py"];
  for (const cmd of commands) {
    try {
      const args = cmd === "py" ? ["-3", "-c", probeScript] : ["-c", probeScript];
      const { stdout } = await execFileAsync(cmd, args, {
        timeout: 15000,
        env: buildPythonEnv(pydepsPath),
        maxBuffer: 2 * 1024 * 1024,
      });
      const parsed = JSON.parse(String(stdout || "").trim() || "{}") as { ok?: boolean };
      if (parsed.ok) return true;
    } catch {
      continue;
    }
  }

  return false;
}

export async function ensurePythonRuntimeProfiles(
  profiles: RuntimeProfile[],
  pydepsPath = getRuntimePydepsPath(),
): Promise<Array<{ profile: RuntimeProfile; installed: boolean }>> {
  const uniqueProfiles = Array.from(new Set(profiles));
  const results: Array<{ profile: RuntimeProfile; installed: boolean }> = [];
  for (const profile of uniqueProfiles) {
    const installed = await ensureRuntimeProfileInstalled(profile, pydepsPath);
    results.push({ profile, installed });
  }
  return results;
}

export async function runPythonJsonScript(scriptName: string, url: string, timeoutMs = 45000): Promise<any | null> {
  return runPythonJsonScriptWithArgs(scriptName, [url], timeoutMs);
}

export async function runPythonJsonScriptWithArgs(scriptName: string, args: string[], timeoutMs = 45000): Promise<any | null> {
  const scriptPath = path.resolve(import.meta.dirname, "scripts", scriptName);
  const configuredPydepsPath = getRuntimePydepsPath();
  const firstAttempt = await executePythonScript(scriptPath, args, timeoutMs, configuredPydepsPath);

  if (!shouldBootstrapRuntime(scriptName, firstAttempt)) {
    return firstAttempt;
  }

  const profile = SCRIPT_RUNTIME_PROFILES[scriptName];
  if (!profile) return firstAttempt;

  const installed = await ensureRuntimeProfileInstalled(profile, configuredPydepsPath);
  if (!installed) return firstAttempt;

  return executePythonScript(scriptPath, args, timeoutMs, configuredPydepsPath);
}
