import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import parse_qs, urlparse


def add_user_site_packages() -> None:
    appdata = os.environ.get("APPDATA", "")
    if not appdata:
        return
    py_version = f"Python{sys.version_info.major}{sys.version_info.minor}"
    user_site = os.path.join(appdata, "Python", py_version, "site-packages")
    if os.path.isdir(user_site) and user_site not in sys.path:
        sys.path.insert(0, user_site)


def add_local_site_packages() -> None:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.environ.get("LAYER1_PYDEPS_PATH", ""),
        os.path.normpath(os.path.join(script_dir, "..", "pydeps_runtime")),
        os.path.normpath(os.path.join(script_dir, "..", "pydeps")),
    ]
    for candidate in candidates:
        if candidate and os.path.isdir(candidate) and candidate not in sys.path:
            sys.path.append(candidate)


def normalize_ffmpeg_dir(path_or_exe: str | None) -> str | None:
    if not path_or_exe:
        return None
    raw = path_or_exe.strip().strip('"')
    if not raw:
        return None
    if os.path.isdir(raw):
        ffmpeg_exe = os.path.join(raw, "ffmpeg.exe")
        ffprobe_exe = os.path.join(raw, "ffprobe.exe")
        if os.path.exists(ffmpeg_exe) and os.path.exists(ffprobe_exe):
            return raw
        return None
    if os.path.isfile(raw):
        base = os.path.dirname(raw)
        ffmpeg_exe = os.path.join(base, "ffmpeg.exe")
        ffprobe_exe = os.path.join(base, "ffprobe.exe")
        if os.path.exists(ffmpeg_exe) and os.path.exists(ffprobe_exe):
            return base
    return None


def get_ffmpeg_location() -> str | None:
    for key in ("LAYER1_FFMPEG_DIR", "LAYER1_FFMPEG_PATH"):
        resolved = normalize_ffmpeg_dir(os.environ.get(key))
        if resolved:
            return resolved
    ffmpeg_on_path = shutil.which("ffmpeg")
    ffprobe_on_path = shutil.which("ffprobe")
    if ffmpeg_on_path and ffprobe_on_path:
        resolved = normalize_ffmpeg_dir(ffmpeg_on_path)
        if resolved:
            return resolved
    try:
        import imageio_ffmpeg  # type: ignore

        ffmpeg_bin = imageio_ffmpeg.get_ffmpeg_exe()
        resolved = normalize_ffmpeg_dir(ffmpeg_bin)
        if resolved:
            return resolved
    except Exception:
        pass
    return None


def sanitize_media_id(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "", value or "")[:80]


def extract_media_id(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    path = parsed.path
    if "youtu.be" in host:
        return sanitize_media_id(path.strip("/").split("/")[0])
    if "youtube.com" in host:
        if path.startswith("/shorts/"):
            parts = path.split("/")
            return sanitize_media_id(parts[2] if len(parts) > 2 else "")
        query = parse_qs(parsed.query)
        if "v" in query and query["v"]:
            return sanitize_media_id(query["v"][0])
    if "instagram.com" in host:
        parts = [p for p in path.split("/") if p]
        if len(parts) >= 2 and parts[0] in {"reel", "reels", "p", "tv"}:
            return sanitize_media_id(parts[1])
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]
    return f"media_{digest}"


def select_timestamps(duration_seconds: float, count: int) -> list[float]:
    if duration_seconds <= 0:
        return [1.0, 3.0, 5.0][:count]
    anchors = [0.18, 0.45, 0.72, 0.88]
    out: list[float] = []
    for anchor in anchors[: max(1, count)]:
        ts = max(0.5, min(duration_seconds - 0.5, duration_seconds * anchor))
        if ts > 0:
            out.append(round(ts, 2))
    deduped: list[float] = []
    seen = set()
    for item in out:
        key = round(item, 1)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped[:count]


def main() -> int:
    add_user_site_packages()
    add_local_site_packages()

    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "URL_REQUIRED"}))
        return 0

    source_url = sys.argv[1].strip()
    frame_count = int(os.environ.get("LAYER1_FRAME_COUNT", "3") or "3")
    max_duration = int(os.environ.get("LAYER1_FRAME_MAX_DURATION_SECONDS", "180") or "180")
    ffmpeg_location = get_ffmpeg_location()
    if not ffmpeg_location:
        print(json.dumps({"ok": False, "error": "FFMPEG_NOT_AVAILABLE"}))
        return 0

    try:
        import yt_dlp  # type: ignore
    except Exception:
        print(json.dumps({"ok": False, "error": "MISSING_YT_DLP"}))
        return 0

    media_id = extract_media_id(source_url)
    temp_dir = tempfile.mkdtemp(prefix=f"wr_frames_{media_id}_")
    out_tmpl = os.path.join(temp_dir, f"{media_id}.%(ext)s")
    ffmpeg_exe = os.path.join(ffmpeg_location, "ffmpeg.exe")
    if not os.path.exists(ffmpeg_exe):
        ffmpeg_exe = shutil.which("ffmpeg") or "ffmpeg"

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "skip_download": False,
        "noplaylist": True,
        "format": "mp4/best[ext=mp4]/best",
        "outtmpl": out_tmpl,
        "ffmpeg_location": ffmpeg_location,
    }

    video_path = ""
    extracted_paths: list[str] = []
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(source_url, download=True)
        duration = float(info.get("duration") or 0)
        if duration and duration > max_duration:
            print(json.dumps({"ok": False, "error": "DURATION_TOO_LONG", "duration_seconds": duration}))
            return 0

        for filename in os.listdir(temp_dir):
            candidate = os.path.join(temp_dir, filename)
            if os.path.isfile(candidate) and not filename.lower().endswith(".jpg"):
                video_path = candidate
                break

        if not video_path:
            print(json.dumps({"ok": False, "error": "VIDEO_NOT_FOUND"}))
            return 0

        timestamps = select_timestamps(duration, max(1, min(frame_count, 4)))
        frames = []
        for index, ts in enumerate(timestamps):
            output_path = os.path.join(temp_dir, f"frame_{index + 1}.jpg")
            cmd = [
                ffmpeg_exe,
                "-y",
                "-ss",
                str(ts),
                "-i",
                video_path,
                "-frames:v",
                "1",
                "-vf",
                "scale='min(960,iw)':-2",
                "-q:v",
                "3",
                output_path,
            ]
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            extracted_paths.append(output_path)
            with open(output_path, "rb") as handle:
                encoded = base64.b64encode(handle.read()).decode("ascii")
            frames.append(
                {
                    "label": f"frame_{index + 1}",
                    "timestampSec": ts,
                    "mimeType": "image/jpeg",
                    "dataBase64": encoded,
                }
            )

        print(
            json.dumps(
                {
                    "ok": bool(frames),
                    "frames": frames,
                    "count": len(frames),
                    "durationSeconds": duration,
                    "ffmpegLocation": ffmpeg_location,
                }
            )
        )
        return 0
    except Exception as err:
        print(json.dumps({"ok": False, "error": f"FRAME_EXTRACTION_FAILED: {err}"}))
        return 0
    finally:
        for path in extracted_paths:
            if os.path.exists(path):
                try:
                    os.remove(path)
                except Exception:
                    pass
        if video_path and os.path.exists(video_path):
            try:
                os.remove(video_path)
            except Exception:
                pass
        if os.path.isdir(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
