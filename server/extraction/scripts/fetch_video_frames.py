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
from runtime_support import (
    build_runtime_diagnostics,
    configure_runtime_paths,
    emit_runtime_debug_log,
    get_ffmpeg_executable,
    get_ffmpeg_location,
)


def short_preview(lines: list[str], max_lines: int = 4, max_chars: int = 600) -> str | None:
    cleaned = [str(line).strip() for line in lines if str(line).strip()]
    if not cleaned:
        return None
    preview = "\n".join(cleaned[:max_lines])
    return preview[:max_chars]


class YtDlpLogger:
    def __init__(self) -> None:
        self.messages: list[str] = []

    def debug(self, msg: str) -> None:
        if msg:
            self.messages.append(str(msg))

    def warning(self, msg: str) -> None:
        if msg:
            self.messages.append(f"WARNING: {msg}")

    def error(self, msg: str) -> None:
        if msg:
            self.messages.append(f"ERROR: {msg}")


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


def dedupe_preserve_order(values: list[float]) -> list[float]:
    out: list[float] = []
    seen = set()
    for item in values:
        key = round(item, 1)
        if key in seen:
            continue
        seen.add(key)
        out.append(round(item, 2))
    return out


def compute_resized_dimensions(width: int | None, height: int | None, max_width: int = 640) -> tuple[int | None, int | None]:
    if not width or not height or width <= 0 or height <= 0:
        return None, None
    if width <= max_width:
        return width, height
    resized_width = max_width
    resized_height = int(round((height * max_width) / width))
    return resized_width, resized_height


def select_scene_edge_timestamps(video_path: str, duration_seconds: float, ffmpeg_exe: str, temp_dir: str) -> tuple[list[float], list[dict]]:
    scene_dir = os.path.join(temp_dir, "scene_frames")
    os.makedirs(scene_dir, exist_ok=True)
    scene_pattern = os.path.join(scene_dir, "scene_%03d.jpg")
    cmd = [
        ffmpeg_exe,
        "-y",
        "-i",
        video_path,
        "-filter:v",
        "select='gt(scene,0.28)',showinfo,scale='min(960,iw)':-2",
        "-vsync",
        "vfr",
        "-q:v",
        "3",
        scene_pattern,
    ]
    completed = subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    stderr = completed.stderr or ""
    scene_times: list[float] = []
    for match in re.finditer(r"pts_time:([0-9]+(?:\.[0-9]+)?)", stderr):
        try:
            scene_times.append(float(match.group(1)))
        except Exception:
            continue

    scene_images = sorted(
        [os.path.join(scene_dir, name) for name in os.listdir(scene_dir) if name.lower().endswith(".jpg")]
    )
    pair_count = min(len(scene_times), len(scene_images))
    pairs = [(scene_times[index], scene_images[index]) for index in range(pair_count)]
    if not pairs:
        fallback = select_timestamps(duration_seconds, 4)
        return fallback, []

    selected_pairs = pairs[:4]
    if len(pairs) > 4:
        tail = pairs[-3:]
        seen_tail = {round(item[0], 1) for item in selected_pairs}
        for item in tail:
            if round(item[0], 1) not in seen_tail:
                selected_pairs.append(item)
                seen_tail.add(round(item[0], 1))

    timestamps = dedupe_preserve_order([item[0] for item in selected_pairs])
    debug = [
        {"timestampSec": round(item[0], 2), "path": item[1], "source": "scene_change"}
        for item in selected_pairs
    ]
    return timestamps, debug


def main() -> int:
    runtime_path_additions = configure_runtime_paths()
    emit_runtime_debug_log("fetch_video_frames.py", runtime_path_additions)
    runtime_debug = build_runtime_diagnostics("fetch_video_frames.py", runtime_path_additions)

    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "URL_REQUIRED"}))
        return 0

    source_url = sys.argv[1].strip()
    selection_mode = (sys.argv[2].strip().lower() if len(sys.argv) >= 3 else "anchors") or "anchors"
    output_mode = (sys.argv[3].strip().lower() if len(sys.argv) >= 4 else "base64") or "base64"
    frame_count = int(os.environ.get("LAYER1_FRAME_COUNT", "3") or "3")
    max_duration = int(os.environ.get("LAYER1_FRAME_MAX_DURATION_SECONDS", "180") or "180")
    ffmpeg_location = get_ffmpeg_location()
    ffmpeg_exe = get_ffmpeg_executable()
    if not ffmpeg_location or not ffmpeg_exe:
        print(json.dumps({"ok": False, "error": "FFMPEG_NOT_AVAILABLE", "debug": {"runtime": runtime_debug}}))
        return 0

    try:
        import yt_dlp  # type: ignore
    except Exception:
        print(json.dumps({"ok": False, "error": "MISSING_YT_DLP", "debug": {"runtime": runtime_debug}}))
        return 0

    media_id = extract_media_id(source_url)
    temp_dir = tempfile.mkdtemp(prefix=f"wr_frames_{media_id}_")
    out_tmpl = os.path.join(temp_dir, f"{media_id}.%(ext)s")

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "skip_download": False,
        "noplaylist": True,
        "format": "mp4/best[ext=mp4]/best",
        "outtmpl": out_tmpl,
        "ffmpeg_location": ffmpeg_exe,
    }
    yt_dlp_logger = YtDlpLogger()
    ydl_opts["logger"] = yt_dlp_logger

    video_path = ""
    extracted_paths: list[str] = []
    frame_debug: list[dict] = []
    media_debug: dict = {"mediaUrlAvailable": False, "durationSeconds": None}
    yt_dlp_debug: dict = {"exitCode": None, "stderrShortPreview": None}
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(source_url, download=True)
        yt_dlp_debug = {
            "exitCode": 0,
            "stderrShortPreview": short_preview(yt_dlp_logger.messages),
        }
        duration = float(info.get("duration") or 0)
        media_debug = {
            "mediaUrlAvailable": bool(info.get("url") or info.get("requested_downloads")),
            "durationSeconds": duration,
            "extractor": info.get("extractor"),
            "webpageUrl": info.get("webpage_url"),
            "thumbnailAvailable": bool(info.get("thumbnail")),
            "width": int(info.get("width") or 0) or None,
            "height": int(info.get("height") or 0) or None,
        }
        original_width = int(info.get("width") or 0) or None
        original_height = int(info.get("height") or 0) or None
        resized_width, resized_height = compute_resized_dimensions(original_width, original_height, 640)
        if duration and duration > max_duration:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "error": "DURATION_TOO_LONG",
                        "duration_seconds": duration,
                        "debug": {
                            "runtime": runtime_debug,
                            "media": media_debug,
                            "ytDlp": yt_dlp_debug,
                            "frameExtraction": {"reason": "duration_too_long"},
                        },
                    }
                )
            )
            return 0

        for filename in os.listdir(temp_dir):
            candidate = os.path.join(temp_dir, filename)
            if os.path.isfile(candidate) and not filename.lower().endswith(".jpg"):
                video_path = candidate
                break

        if not video_path:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "error": "VIDEO_NOT_FOUND",
                        "debug": {
                            "runtime": runtime_debug,
                            "media": media_debug,
                            "ytDlp": yt_dlp_debug,
                            "tempDir": temp_dir,
                            "frameExtraction": {"reason": "video_not_found", "tempDir": temp_dir},
                        },
                    }
                )
            )
            return 0

        scene_selection_debug: list[dict] = []
        if selection_mode == "scene_edges":
            timestamps, scene_selection_debug = select_scene_edge_timestamps(video_path, duration, ffmpeg_exe, temp_dir)
        else:
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
                "scale='min(640,iw)':-2",
                "-q:v",
                "6",
                output_path,
            ]
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            extracted_paths.append(output_path)
            frame_size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
            frame_debug.append({
                "path": output_path,
                "timestampSec": ts,
                "sizeBytes": frame_size,
                "originalWidth": original_width,
                "originalHeight": original_height,
                "resizedWidth": resized_width,
                "resizedHeight": resized_height,
            })
            frame_payload = {
                "label": f"frame_{index + 1}",
                "timestampSec": ts,
                "mimeType": "image/jpeg",
                "sizeBytes": frame_size,
                "sourcePath": output_path,
                "originalWidth": original_width,
                "originalHeight": original_height,
                "resizedWidth": resized_width,
                "resizedHeight": resized_height,
            }
            if output_mode == "manifest":
                frames.append(frame_payload)
            else:
                with open(output_path, "rb") as handle:
                    encoded = base64.b64encode(handle.read()).decode("ascii")
                frames.append(
                    {
                        **frame_payload,
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
                    "outputMode": output_mode,
                    "ffmpegLocation": ffmpeg_location,
                    "debug": {
                        "runtime": runtime_debug,
                        "media": media_debug,
                        "ytDlp": yt_dlp_debug,
                        "frameExtraction": {
                            "reason": "frames_extracted",
                            "videoPath": video_path,
                            "videoSizeBytes": os.path.getsize(video_path) if video_path and os.path.exists(video_path) else None,
                            "frameFilePaths": [item["path"] for item in frame_debug],
                            "frameFileSizes": [item["sizeBytes"] for item in frame_debug],
                            "timestamps": [item["timestampSec"] for item in frame_debug],
                            "selectionMode": selection_mode,
                            "sceneSelection": scene_selection_debug,
                            "ffmpegExe": ffmpeg_exe,
                            "tempDir": temp_dir,
                        },
                    },
                }
            )
        )
        return 0
    except Exception as err:
        yt_dlp_debug = {
            "exitCode": yt_dlp_debug.get("exitCode") if isinstance(yt_dlp_debug, dict) and yt_dlp_debug.get("exitCode") is not None else 1,
            "stderrShortPreview": short_preview(yt_dlp_logger.messages + [str(err)]),
        }
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": f"FRAME_EXTRACTION_FAILED: {err}",
                    "debug": {
                        "runtime": runtime_debug,
                        "media": media_debug,
                        "ytDlp": yt_dlp_debug,
                        "frameExtraction": {
                            "reason": "frame_extraction_failed",
                            "videoPath": video_path or None,
                            "frameFilePaths": [item["path"] for item in frame_debug],
                            "frameFileSizes": [item["sizeBytes"] for item in frame_debug],
                            "timestamps": [item["timestampSec"] for item in frame_debug],
                            "selectionMode": selection_mode,
                            "ffmpegExe": ffmpeg_exe,
                        },
                    },
                }
            )
        )
        return 0
    finally:
        if output_mode != "manifest":
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
