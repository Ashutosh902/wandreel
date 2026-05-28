import json
import os
import re
import sys
from urllib.parse import parse_qs, urlparse


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
        os.path.normpath(os.path.join(script_dir, "..", "..", "..", "pinshort_dataset_builder", "pydeps")),
    ]

    for candidate in candidates:
        if candidate and os.path.isdir(candidate) and candidate not in sys.path:
            sys.path.insert(0, candidate)


add_user_site_packages()
add_local_site_packages()


def extract_video_id(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    path = parsed.path

    if "youtu.be" in host:
        return path.strip("/").split("/")[0]

    if "youtube.com" in host:
        if path.startswith("/shorts/"):
            parts = path.split("/")
            return parts[2] if len(parts) > 2 else ""

        query = parse_qs(parsed.query)
        if "v" in query and query["v"]:
            return query["v"][0]

    match = re.search(r"(?:v=|/shorts/|youtu\.be/)([A-Za-z0-9_-]{11})", url)
    return match.group(1) if match else ""


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "URL_REQUIRED"}))
        return 0

    url = sys.argv[1]
    video_id = extract_video_id(url)
    if not video_id:
        print(json.dumps({"ok": False, "error": "INVALID_YOUTUBE_URL"}))
        return 0

    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except Exception:
        print(json.dumps({"ok": False, "error": "MISSING_YOUTUBE_TRANSCRIPT_API"}))
        return 0

    try:
        transcript_rows = YouTubeTranscriptApi().fetch(video_id, languages=["en", "hi", "en-US", "en-GB", "ta", "te", "mr", "bn"])
        transcript_parts = []
        for row in transcript_rows:
            if hasattr(row, "text"):
                text = str(row.text or "").strip()
            elif isinstance(row, dict):
                text = str(row.get("text", "")).strip()
            else:
                text = ""
            if text:
                transcript_parts.append(text)
        transcript = " ".join(transcript_parts)
        print(json.dumps({"ok": True, "video_id": video_id, "transcript": transcript}))
    except Exception as err:
        print(json.dumps({"ok": False, "error": f"TRANSCRIPT_FETCH_FAILED: {err}"}))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())




