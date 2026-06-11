import hashlib
import json
import os
import re
import sys
from urllib.parse import parse_qs, urlparse

from runtime_support import configure_runtime_paths, emit_runtime_debug_log, get_ffmpeg_executable


RUNTIME_PATH_ADDITIONS = configure_runtime_paths()
emit_runtime_debug_log("fetch_media_whisper.py", RUNTIME_PATH_ADDITIONS)


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

    match = re.search(r"(?:v=|/shorts/|youtu\.be/)([A-Za-z0-9_-]{11})", url)
    if match:
        return sanitize_media_id(match.group(1))

    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]
    return f"media_{digest}"


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "URL_REQUIRED"}))
        return 0

    source_url = sys.argv[1]
    max_seconds = int(sys.argv[2]) if len(sys.argv) > 2 else int(os.environ.get("LAYER1_WHISPER_MAX_SECONDS", "180"))
    media_id = extract_media_id(source_url)
    if not media_id:
        print(json.dumps({"ok": False, "error": "INVALID_MEDIA_URL"}))
        return 0

    try:
        import yt_dlp  # type: ignore
    except Exception:
        print(json.dumps({"ok": False, "error": "MISSING_YT_DLP"}))
        return 0

    out_dir = os.path.join(os.getcwd(), "tmp_whisper_audio")
    os.makedirs(out_dir, exist_ok=True)
    out_tmpl = os.path.join(out_dir, f"{media_id}.%(ext)s")

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "skip_download": False,
        "noplaylist": True,
        "format": "bestaudio/best",
        "outtmpl": out_tmpl,
    }

    ffmpeg_location = get_ffmpeg_executable()
    if ffmpeg_location:
        ydl_opts["ffmpeg_location"] = ffmpeg_location

    audio_path = None
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(source_url, download=True)
            duration = int(info.get("duration") or 0)
            if duration and duration > max_seconds:
                print(json.dumps({"ok": False, "error": "DURATION_TOO_LONG", "duration_seconds": duration}))
                return 0

        preferred_suffixes = (".mp3", ".m4a", ".webm", ".mp4", ".aac", ".opus")
        candidates = [
            os.path.join(out_dir, f"{media_id}{suffix}")
            for suffix in preferred_suffixes
        ]
        for candidate in candidates:
            if os.path.isfile(candidate):
                audio_path = candidate
                break

        if not audio_path:
            discovered: list[str] = []
            for filename in os.listdir(out_dir):
                candidate = os.path.join(out_dir, filename)
                if not os.path.isfile(candidate):
                    continue
                if filename.endswith((".part", ".ytdl", ".json")):
                    continue
                if filename.startswith(media_id) or filename.lower().endswith(preferred_suffixes):
                    discovered.append(candidate)
            if discovered:
                audio_path = discovered[0]

        if not audio_path:
            print(json.dumps({"ok": False, "error": "AUDIO_NOT_FOUND"}))
            return 0

        try:
            from faster_whisper import WhisperModel  # type: ignore
        except Exception:
            print(json.dumps({"ok": False, "error": "MISSING_FASTER_WHISPER"}))
            return 0

        model_name = os.environ.get("LAYER1_WHISPER_MODEL", "small")
        preferred_device = os.environ.get("LAYER1_WHISPER_DEVICE", "auto").lower().strip()
        explicit_compute = os.environ.get("LAYER1_WHISPER_COMPUTE_TYPE", "").strip().lower()

        device_candidates: list[tuple[str, str]] = []
        if preferred_device in ("", "auto", "cuda"):
            device_candidates.append(("cuda", explicit_compute or "float16"))
            device_candidates.append(("cpu", "int8"))
        elif preferred_device == "cpu":
            device_candidates.append(("cpu", explicit_compute or "int8"))
        else:
            device_candidates.append((preferred_device, explicit_compute or "int8"))
            if preferred_device != "cpu":
                device_candidates.append(("cpu", "int8"))

        model = None
        last_model_error = ""
        selected_device = ""
        selected_compute = ""
        for device, compute_type in device_candidates:
            try:
                model = WhisperModel(model_name, device=device, compute_type=compute_type)
                selected_device = device
                selected_compute = compute_type
                break
            except Exception as model_err:
                last_model_error = str(model_err)
                continue

        if model is None:
            print(json.dumps({"ok": False, "error": f"MISSING_WHISPER_RUNTIME: {last_model_error}"}))
            return 0

        try:
            segments, _ = model.transcribe(audio_path, beam_size=3)
        except Exception as transcribe_err:
            if selected_device == "cuda":
                model = WhisperModel(model_name, device="cpu", compute_type="int8")
                selected_device = "cpu"
                selected_compute = "int8"
                segments, _ = model.transcribe(audio_path, beam_size=3)
            else:
                raise transcribe_err

        transcript_parts = [seg.text.strip() for seg in segments if getattr(seg, "text", "").strip()]
        transcript = " ".join(transcript_parts).strip()

        print(
            json.dumps(
                {
                    "ok": True,
                    "media_id": media_id,
                    "transcript": transcript,
                    "source": "whisper",
                    "device": selected_device,
                    "compute_type": selected_compute,
                }
            )
        )
        return 0
    except Exception as err:
        print(json.dumps({"ok": False, "error": f"WHISPER_TRANSCRIBE_FAILED: {err}", "ffmpeg_location": ffmpeg_location or ""}))
        return 0
    finally:
        if audio_path and os.path.exists(audio_path):
            try:
                os.remove(audio_path)
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
