import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ensurePythonRuntimeProfiles,
  getConfiguredRuntimePydepsPath,
} from "./extraction/pythonRunner";

const execFileAsync = promisify(execFile);

type RuntimeHealthPayload = {
  ok?: boolean;
  runtime?: {
    pythonExecutable?: string | null;
    layer1PydepsPath?: string | null;
    ytDlp?: { ok?: boolean; path?: string | null; error?: string | null };
    ytDlpVersion?: { ok?: boolean; version?: string | null; error?: string | null };
    resolvedFfmpegExecutable?: string | null;
    ffmpegVersion?: { ok?: boolean; version?: string | null; error?: string | null };
  };
};

function prependPath(entry: string) {
  if (!entry) return;
  const current = String(process.env.PATH || "");
  const delimiter = path.delimiter;
  const parts = current.split(delimiter).filter(Boolean);
  if (parts.includes(entry)) return;
  process.env.PATH = [entry, ...parts].join(delimiter);
}

async function createFfmpegShim(ffmpegExecutable: string): Promise<string> {
  const binDir = path.join(os.tmpdir(), "wandreel-runtime-bin");
  await mkdir(binDir, { recursive: true });

  if (process.platform === "win32") {
    const shimPath = path.join(binDir, "ffmpeg.cmd");
    const contents = `@echo off\r\n"${ffmpegExecutable}" %*\r\n`;
    await writeFile(shimPath, contents, "utf8");
    return shimPath;
  }

  const shimPath = path.join(binDir, "ffmpeg");
  const contents = `#!/usr/bin/env sh\nexec "${ffmpegExecutable}" "$@"\n`;
  await writeFile(shimPath, contents, { encoding: "utf8", mode: 0o755 });
  return shimPath;
}

async function readRuntimeHealth(pydepsPath: string): Promise<RuntimeHealthPayload | null> {
  const scriptPath = path.resolve(import.meta.dirname, "extraction", "scripts", "check_runtime_health.py");
  const commands = ["python", "py"];

  for (const command of commands) {
    try {
      const commandArgs = command === "py" ? ["-3", scriptPath] : [scriptPath];
      const { stdout } = await execFileAsync(command, commandArgs, {
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
          LAYER1_PYDEPS_PATH: pydepsPath,
        },
      });
      const raw = String(stdout || "").trim();
      if (!raw) continue;
      return JSON.parse(raw) as RuntimeHealthPayload;
    } catch {
      continue;
    }
  }

  return null;
}

async function bootstrapExtractionRuntime() {
  const pydepsPath = getConfiguredRuntimePydepsPath();
  process.env.LAYER1_AUTO_BOOTSTRAP_PYDEPS = process.env.LAYER1_AUTO_BOOTSTRAP_PYDEPS || "true";
  process.env.LAYER1_RUNTIME_PYDEPS_DIR = process.env.LAYER1_RUNTIME_PYDEPS_DIR || pydepsPath;
  process.env.LAYER1_PYDEPS_PATH = process.env.LAYER1_PYDEPS_PATH || pydepsPath;
  process.env.LAYER1_ALLOW_BUNDLED_PYDEPS_FALLBACK = process.env.LAYER1_ALLOW_BUNDLED_PYDEPS_FALLBACK || "true";

  let profileResults: Array<{ profile: string; installed: boolean }> = [];
  try {
    profileResults = await ensurePythonRuntimeProfiles(["instagram", "media"], pydepsPath);
  } catch (error) {
    console.warn("[extraction-runtime-bootstrap]", {
      ok: false,
      pydepsPath,
      error: error instanceof Error ? error.message : String(error || "unknown_error"),
    });
  }

  const health = await readRuntimeHealth(pydepsPath);
  const ffmpegExecutable = String(health?.runtime?.resolvedFfmpegExecutable || "").trim();
  let ffmpegCommandVersion: string | null = null;

  if (ffmpegExecutable) {
    const shimPath = await createFfmpegShim(ffmpegExecutable);
    prependPath(path.dirname(shimPath));
    process.env.LAYER1_FFMPEG_PATH = ffmpegExecutable;
    try {
      const { stdout, stderr } = await execFileAsync("ffmpeg", ["-version"], { env: process.env });
      ffmpegCommandVersion = String(stdout || stderr || "").split(/\r?\n/)[0]?.trim() || null;
    } catch (error) {
      console.warn("[extraction-runtime-bootstrap]", {
        ok: false,
        step: "ffmpeg_command_check_failed",
        error: error instanceof Error ? error.message : String(error || "unknown_error"),
      });
    }
  }

  console.info("[extraction-runtime-startup]", {
    ok: true,
    pydepsPath,
    profiles: profileResults,
    ytDlpAvailable: Boolean(health?.runtime?.ytDlp?.ok),
    ytDlpVersion: health?.runtime?.ytDlpVersion?.version || null,
    ffmpegAvailable: Boolean(health?.runtime?.ffmpegVersion?.ok),
    ffmpegVersion: health?.runtime?.ffmpegVersion?.version || null,
    ffmpegCommandAvailable: Boolean(ffmpegCommandVersion),
    ffmpegCommandVersion,
    resolvedFfmpegExecutable: health?.runtime?.resolvedFfmpegExecutable || null,
  });
}

await bootstrapExtractionRuntime();
await import("./index.ts");
