import json
import os
import sys
import tempfile
import re
from urllib.parse import urlparse
from typing import Optional
from runtime_support import configure_runtime_paths, emit_runtime_debug_log


RUNTIME_PATH_ADDITIONS = configure_runtime_paths()
emit_runtime_debug_log("fetch_ocr_text.py", RUNTIME_PATH_ADDITIONS)


def detect_platform(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    if "youtube.com" in host or "youtu.be" in host:
        return "youtube"
    if "instagram.com" in host:
        return "instagram"
    return "unknown"


def strip_ansi(text: str) -> str:
    return re.sub(r"\x1b\[[0-9;]*m", "", str(text or "")).strip()


def classify_fetch_error(raw_error: str) -> str:
    e = strip_ansi(raw_error).lower()
    if "empty media response" in e or "api is not granting access" in e:
        return "media_access_denied"
    if "failed to establish a new connection" in e or "winerror 10013" in e:
        return "network_blocked"
    if "thumbnail_not_found" in e:
        return "thumbnail_not_found"
    return "fetch_failed"


def build_instagram_cookiefile() -> Optional[str]:
    sessionid = (os.environ.get("INSTAGRAM_SESSIONID", "") or os.environ.get("IG_SESSIONID", "")).strip()
    if not sessionid or sessionid.upper().startswith("YOUR_"):
        return None

    content = (
        "# Netscape HTTP Cookie File\n"
        ".instagram.com\tTRUE\t/\tTRUE\t2147483647\tsessionid\t"
        + sessionid
        + "\n"
    )
    with tempfile.NamedTemporaryFile(delete=False, suffix=".txt", mode="w", encoding="utf-8") as f:
        f.write(content)
        return f.name


def extract_instagram_shortcode(url: str) -> str:
    parsed = urlparse(url)
    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) >= 2 and parts[0] in {"reel", "p", "tv"}:
        return parts[1].strip()
    return ""


def get_instagram_thumbnail_authenticated(url: str) -> str:
    try:
        import instaloader  # type: ignore
    except Exception:
        return ""

    shortcode = extract_instagram_shortcode(url)
    if not shortcode:
        return ""

    username = os.environ.get("INSTAGRAM_USERNAME", "").strip()
    password = os.environ.get("INSTAGRAM_PASSWORD", "").strip()
    sessionid = (os.environ.get("INSTAGRAM_SESSIONID", "") or os.environ.get("IG_SESSIONID", "")).strip()

    if not sessionid and (not username or not password):
        return ""

    loader = instaloader.Instaloader(
        quiet=True,
        sleep=False,
        download_pictures=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
    )
    ctx = loader.context

    try:
        if sessionid:
            ctx._session.cookies.set("sessionid", sessionid, domain=".instagram.com")
            ctx.username = username or "session_user"
        else:
            ctx.login(username, password)

        post = instaloader.Post.from_shortcode(ctx, shortcode)
        return str(getattr(post, "url", "") or "").strip()
    except Exception:
        return ""


def get_thumbnail_url(url: str, platform: str) -> tuple[str, str]:
    import yt_dlp  # type: ignore

    if platform == "instagram":
        instaloader_thumb = get_instagram_thumbnail_authenticated(url)
        if instaloader_thumb:
            return instaloader_thumb, ""

    ydl_opts = {
        "quiet": True,
        "skip_download": True,
        "extract_flat": False,
        "noplaylist": True,
    }
    cookiefile = ""
    if platform == "instagram":
        maybe_cookiefile = build_instagram_cookiefile()
        if maybe_cookiefile:
            cookiefile = maybe_cookiefile
            ydl_opts["cookiefile"] = maybe_cookiefile

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
    thumb = str(info.get("thumbnail") or "").strip()
    if thumb:
        return thumb, cookiefile
    thumbs = info.get("thumbnails") or []
    for t in reversed(thumbs):
        u = str((t or {}).get("url") or "").strip()
        if u:
            return u, cookiefile
    return "", cookiefile


def download_image(url: str) -> str:
    import requests  # type: ignore

    headers = {"User-Agent": "Mozilla/5.0 (compatible; PinShort/1.0)"}
    res = requests.get(url, headers=headers, timeout=15)
    res.raise_for_status()
    suffix = ".jpg"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        f.write(res.content)
        return f.name


def run_pytesseract(image_path: str) -> str:
    from PIL import Image  # type: ignore
    import pytesseract  # type: ignore

    return str(pytesseract.image_to_string(Image.open(image_path)) or "").strip()


def run_easyocr(image_path: str) -> str:
    import easyocr  # type: ignore

    reader = easyocr.Reader(["en"], gpu=False)
    parts = reader.readtext(image_path, detail=0, paragraph=True)
    return " ".join([str(x).strip() for x in parts if str(x).strip()]).strip()


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "URL_REQUIRED"}))
        return 0

    image_path_arg = ""
    if sys.argv[1] == "--image-path":
        if len(sys.argv) < 3:
            print(json.dumps({"ok": False, "error": "IMAGE_PATH_REQUIRED"}))
            return 0
        image_path_arg = sys.argv[2].strip()
        source_url = ""
        platform = "local_image"
    else:
        source_url = sys.argv[1].strip()
        platform = detect_platform(source_url)
    image_path = ""
    cookiefile = ""
    try:
        if image_path_arg:
            image_path = image_path_arg
        else:
            thumb_url, cookiefile = get_thumbnail_url(source_url, platform)
            if not thumb_url:
                print(
                    json.dumps(
                        {
                            "ok": False,
                            "platform": platform,
                            "status": "thumbnail_not_found",
                            "errorCode": "thumbnail_not_found",
                            "error": "THUMBNAIL_NOT_FOUND",
                        }
                    )
                )
                return 0
            image_path = download_image(thumb_url)

        text = ""
        engine = ""
        errors: list[str] = []

        try:
            text = run_pytesseract(image_path)
            engine = "pytesseract"
        except Exception as e1:
            errors.append(f"pytesseract:{e1}")
            try:
                text = run_easyocr(image_path)
                engine = "easyocr"
            except Exception as e2:
                errors.append(f"easyocr:{e2}")

        if text.strip():
            print(
                json.dumps(
                    {
                        "ok": True,
                        "platform": platform,
                        "engine": engine,
                        "text": text.strip(),
                        "chars": len(text.strip()),
                        "status": "fetched",
                    }
                )
            )
        else:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "platform": platform,
                        "status": "not_available",
                        "errorCode": "ocr_text_empty",
                        "error": "OCR_TEXT_EMPTY",
                        "errors": errors,
                    }
                )
            )
    except Exception as err:
        clean_err = strip_ansi(str(err))
        print(
            json.dumps(
                {
                    "ok": False,
                    "platform": platform,
                    "status": classify_fetch_error(clean_err),
                    "errorCode": classify_fetch_error(clean_err),
                    "error": f"OCR_FETCH_FAILED: {clean_err}",
                }
            )
        )
    finally:
        if image_path and not image_path_arg and os.path.exists(image_path):
            try:
                os.remove(image_path)
            except Exception:
                pass
        if cookiefile and os.path.exists(cookiefile):
            try:
                os.remove(cookiefile)
            except Exception:
                pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
