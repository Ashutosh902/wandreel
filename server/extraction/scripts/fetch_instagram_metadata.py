import json
import os
import re
import sys
from urllib.parse import urlparse


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


def extract_shortcode(url: str) -> str:
    parsed = urlparse(url)
    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) >= 2 and parts[0] in {"reel", "p", "tv"}:
        return parts[1].strip()
    return ""


def fetch_public_metadata(url: str) -> dict:
    try:
        import requests  # type: ignore
    except Exception:
        return {"ok": False, "error": "MISSING_REQUESTS"}

    headers = {"User-Agent": "Mozilla/5.0 (compatible; PinShort/1.0)"}
    try:
        res = requests.get(url, headers=headers, timeout=12)
    except Exception as err:
        return {"ok": False, "error": f"PUBLIC_FETCH_FAILED: {err}"}
    if res.status_code != 200:
        return {"ok": False, "error": f"PUBLIC_HTTP_{res.status_code}"}

    html = res.text
    title = ""
    description = ""
    owner = ""

    m_title = re.search(r'<meta property="og:title" content="([^"]*)"', html)
    if m_title:
        title = m_title.group(1).strip()
    m_desc = re.search(r'<meta property="og:description" content="([^"]*)"', html)
    if m_desc:
        description = m_desc.group(1).strip()

    if description:
        m_owner = re.match(r"@([A-Za-z0-9._]+)\b", description)
        if m_owner:
            owner = m_owner.group(1)

    return {
        "ok": True,
        "title": title,
        "description": description,
        "owner": owner,
        "comments": [],
        "source": "public_meta",
        "authenticated": False,
    }


def fetch_authenticated(shortcode: str, comments_limit: int) -> dict:
    try:
        import instaloader  # type: ignore
    except Exception:
        return {"ok": False, "error": "MISSING_INSTALOADER"}

    username = os.environ.get("INSTAGRAM_USERNAME", "").strip()
    password = os.environ.get("INSTAGRAM_PASSWORD", "").strip()
    sessionid = os.environ.get("INSTAGRAM_SESSIONID", "").strip() or os.environ.get("IG_SESSIONID", "").strip()

    if not shortcode:
        return {"ok": False, "error": "MISSING_SHORTCODE"}
    if not sessionid and (not username or not password):
        return {"ok": False, "error": "AUTH_CONFIG_MISSING"}

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
        caption = str(post.caption or "").strip()
        owner = str(getattr(post, "owner_username", "") or "").strip()
        comments: list[str] = []
        try:
            for c in post.get_comments():
                text = str(getattr(c, "text", "") or "").strip()
                if text:
                    comments.append(text)
                if len(comments) >= comments_limit:
                    break
        except Exception:
            # Comments often fail due to privacy/rate limits; keep caption if available.
            pass

        return {
            "ok": True,
            "title": "",
            "description": caption,
            "owner": owner,
            "comments": comments,
            "source": "instaloader_auth",
            "authenticated": True,
        }
    except Exception as err:
        return {"ok": False, "error": f"AUTH_FETCH_FAILED: {err}"}


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "URL_REQUIRED"}))
        return 0

    url = sys.argv[1].strip()
    comments_limit = 15
    if len(sys.argv) > 2:
        try:
            comments_limit = max(1, min(50, int(sys.argv[2])))
        except Exception:
            comments_limit = 15

    shortcode = extract_shortcode(url)
    auth_mode = os.environ.get("INSTAGRAM_AUTH_MODE", "auto").strip().lower()

    auth_result = {"ok": False, "error": "AUTH_NOT_ATTEMPTED"}
    if auth_mode in {"auto", "authenticated", "auth"}:
        auth_result = fetch_authenticated(shortcode, comments_limit)
        if auth_result.get("ok"):
            print(json.dumps(auth_result))
            return 0

    public_result = fetch_public_metadata(url)
    if public_result.get("ok"):
        public_result["authFallbackError"] = auth_result.get("error") if auth_result else None
        print(json.dumps(public_result))
        return 0

    print(
        json.dumps(
            {
                "ok": False,
                "error": "INSTAGRAM_METADATA_UNAVAILABLE",
                "authError": auth_result.get("error"),
                "publicError": public_result.get("error"),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

