import json
import sys
from runtime_support import configure_runtime_paths, emit_runtime_debug_log


RUNTIME_PATH_ADDITIONS = configure_runtime_paths()
emit_runtime_debug_log("fetch_youtube_metadata.py", RUNTIME_PATH_ADDITIONS)


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "URL_REQUIRED"}))
        return 0

    url = sys.argv[1]

    try:
        import yt_dlp  # type: ignore
    except Exception:
        print(json.dumps({"ok": False, "error": "MISSING_YT_DLP"}))
        return 0

    ydl_opts = {
        "quiet": True,
        "skip_download": True,
        "extract_flat": False,
        "noplaylist": True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

        title = str(info.get("title") or "").strip()
        description = str(info.get("description") or "").strip()
        creator = str(
            info.get("uploader")
            or info.get("channel")
            or info.get("channel_id")
            or ""
        ).strip()
        duration_raw = info.get("duration")
        try:
            duration_seconds = int(duration_raw) if duration_raw is not None else None
        except Exception:
            duration_seconds = None

        print(
            json.dumps(
                {
                    "ok": True,
                    "title": title,
                    "description": description,
                    "creator": creator,
                    "duration_seconds": duration_seconds,
                }
            )
        )
    except Exception as err:
        print(json.dumps({"ok": False, "error": f"YTDLP_FETCH_FAILED: {err}"}))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
