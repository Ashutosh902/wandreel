import importlib
import json
import os
import shutil
import sys
from typing import Any


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
EXTRACTION_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, ".."))


def _unique_paths(paths: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for path in paths:
        normalized = os.path.normpath(path)
        if normalized in seen:
            continue
        seen.add(normalized)
        unique.append(normalized)
    return unique


def add_user_site_packages() -> list[str]:
    additions: list[str] = []
    appdata = os.environ.get("APPDATA", "")
    if not appdata:
        return additions
    py_version = f"Python{sys.version_info.major}{sys.version_info.minor}"
    user_site = os.path.join(appdata, "Python", py_version, "site-packages")
    if os.path.isdir(user_site):
        additions.append(user_site)
    return additions


def build_site_package_candidates() -> list[str]:
    candidates: list[str] = []
    external_pydeps = os.environ.get("LAYER1_PYDEPS_PATH", "").strip()
    if external_pydeps:
        candidates.append(external_pydeps)
        allow_bundled_fallback = os.environ.get("LAYER1_ALLOW_BUNDLED_PYDEPS_FALLBACK", "").strip().lower() in {
            "1",
            "true",
            "yes",
        }
        if not allow_bundled_fallback:
            return _unique_paths(candidates)

    candidates.extend(
        [
            os.path.join(EXTRACTION_DIR, "pydeps_runtime"),
            os.path.join(EXTRACTION_DIR, "pydeps"),
            os.path.normpath(
                os.path.join(SCRIPT_DIR, "..", "..", "..", "pinshort_dataset_builder", "pydeps_run")
            ),
            os.path.normpath(
                os.path.join(SCRIPT_DIR, "..", "..", "..", "pinshort_dataset_builder", "pydeps")
            ),
        ]
    )
    return _unique_paths(candidates)


def configure_runtime_paths() -> list[str]:
    desired_priority = _unique_paths(build_site_package_candidates() + add_user_site_packages())
    additions: list[str] = []
    for candidate in reversed(desired_priority):
        if not candidate or not os.path.isdir(candidate) or candidate in sys.path:
            continue
        sys.path.insert(0, candidate)
        additions.append(candidate)
    additions.reverse()
    return additions


def _find_ffmpeg_executable_in_dir(directory: str) -> str | None:
    if not directory or not os.path.isdir(directory):
        return None
    preferred_names = ("ffmpeg", "ffmpeg.exe")
    for name in preferred_names:
        candidate = os.path.join(directory, name)
        if os.path.isfile(candidate):
            return candidate
    try:
        for entry in os.listdir(directory):
            if not entry.lower().startswith("ffmpeg"):
                continue
            candidate = os.path.join(directory, entry)
            if os.path.isfile(candidate):
                return candidate
    except Exception:
        return None
    return None


def normalize_ffmpeg_dir(path_or_exe: str | None) -> str | None:
    if not path_or_exe:
        return None
    raw = path_or_exe.strip().strip('"')
    if not raw:
        return None
    if os.path.isdir(raw):
        if _find_ffmpeg_executable_in_dir(raw):
            return raw
        return None
    if os.path.isfile(raw):
        filename = os.path.basename(raw).lower()
        if filename.startswith("ffmpeg"):
            base = os.path.dirname(raw)
            return base
    return None


def get_ffmpeg_executable() -> str | None:
    for key in ("LAYER1_FFMPEG_PATH", "LAYER1_FFMPEG_DIR"):
        raw = os.environ.get(key)
        if not raw:
            continue
        normalized_dir = normalize_ffmpeg_dir(raw)
        if not normalized_dir:
            continue
        if os.path.isfile(raw.strip().strip('"')):
            return raw.strip().strip('"')
        candidate = _find_ffmpeg_executable_in_dir(normalized_dir)
        if candidate:
            return candidate

    ffmpeg_on_path = shutil.which("ffmpeg")
    if ffmpeg_on_path:
        return ffmpeg_on_path

    local_appdata = os.environ.get("LOCALAPPDATA", "")
    if local_appdata:
        winget_links = os.path.join(local_appdata, "Microsoft", "WinGet", "Links")
        candidate = _find_ffmpeg_executable_in_dir(winget_links)
        if candidate:
            return candidate

    try:
        imageio_ffmpeg = importlib.import_module("imageio_ffmpeg")
        ffmpeg_bin = imageio_ffmpeg.get_ffmpeg_exe()
        if ffmpeg_bin and os.path.isfile(ffmpeg_bin):
            return ffmpeg_bin
    except Exception:
        pass

    return None


def get_ffmpeg_location() -> str | None:
    ffmpeg_executable = get_ffmpeg_executable()
    if not ffmpeg_executable:
        return None
    return normalize_ffmpeg_dir(ffmpeg_executable)


def _module_check(module_name: str) -> dict[str, Any]:
    try:
        module = importlib.import_module(module_name)
        result: dict[str, Any] = {"ok": True, "path": getattr(module, "__file__", None)}
        if module_name == "imageio_ffmpeg":
            try:
                ffmpeg_exe = module.get_ffmpeg_exe()
                result["ffmpegExe"] = ffmpeg_exe
                result["ffmpegDir"] = normalize_ffmpeg_dir(ffmpeg_exe)
            except Exception as err:
                result["ffmpegError"] = str(err)
        return result
    except Exception as err:
        return {"ok": False, "error": str(err)}


def build_runtime_diagnostics(script_name: str, sys_path_additions: list[str]) -> dict[str, Any]:
    return {
        "script": script_name,
        "pythonExecutable": sys.executable,
        "layer1PydepsPath": os.environ.get("LAYER1_PYDEPS_PATH", "").strip() or None,
        "sysPathAdditions": sys_path_additions,
        "instaloader": _module_check("instaloader"),
        "ytDlp": _module_check("yt_dlp"),
        "imageioFfmpeg": _module_check("imageio_ffmpeg"),
        "resolvedFfmpegExecutable": get_ffmpeg_executable(),
        "resolvedFfmpegPath": get_ffmpeg_location(),
    }


def emit_runtime_debug_log(script_name: str, sys_path_additions: list[str]) -> None:
    payload = build_runtime_diagnostics(script_name, sys_path_additions)
    print(json.dumps({"runtimeDebug": payload}), file=sys.stderr, flush=True)
