import json
import os
import sys


def add_user_site_packages() -> None:
    appdata = os.environ.get("APPDATA", "")
    if not appdata:
        return
    py_version = f"Python{sys.version_info.major}{sys.version_info.minor}"
    user_site = os.path.join(appdata, "Python", py_version, "site-packages")
    if os.path.isdir(user_site) and user_site not in sys.path:
        sys.path.append(user_site)


def add_local_site_packages() -> None:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.environ.get("LAYER1_PYDEPS_PATH", ""),
        os.path.normpath(os.path.join(script_dir, "..", "..", "..", "pinshort_dataset_builder", "pydeps_run")),
        os.path.normpath(os.path.join(script_dir, "..", "..", "..", "pinshort_dataset_builder", "pydeps")),
    ]

    for candidate in candidates:
        if candidate and os.path.isdir(candidate) and candidate not in sys.path:
            sys.path.insert(0, candidate)


add_user_site_packages()
add_local_site_packages()


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
