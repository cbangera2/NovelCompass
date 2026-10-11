import os
import hashlib
import json
import time
import random
import urllib.request
import urllib.parse
import urllib.error
import tempfile
from pathlib import Path
from typing import Optional, Dict, Protocol, Tuple

CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "cache")
DEFAULT_BROWSER_PROFILE = Path(CACHE_DIR).parent / "browser-profile"

BLOCK_MARKERS = (
    "cf-browser-verification",
    "cf-chl-bypass",
    "<title>just a moment",
    "verify you are human",
    "unusual traffic from your computer network",
)


def contains_challenge(content_text: str) -> bool:
    lowered = content_text.lower()
    return any(marker in lowered for marker in BLOCK_MARKERS)


class FetchTransport(Protocol):
    def fetch(
        self,
        url: str,
        *,
        post_data: Optional[Dict] = None,
        timeout: float = 30.0,
    ) -> Tuple[Optional[str], int]:
        ...

    def close(self) -> None:
        ...


class BrowserSessionTransport:
    """Opt-in headed browser transport using a persistent local session.

    This does not solve or bypass challenges. The operator must complete login or
    challenge pages manually in the visible browser before starting a crawl.
    """

    def __init__(
        self,
        profile_dir: Path = DEFAULT_BROWSER_PROFILE,
        *,
        headless: bool = False,
    ):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            raise RuntimeError(
                "Browser transport requires Playwright. Install it with "
                "`.venv/bin/pip install playwright` and then "
                "`.venv/bin/playwright install chromium`."
            ) from exc

        self.profile_dir = Path(profile_dir).expanduser().resolve()
        self.profile_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.profile_dir, 0o700)
        self._playwright = sync_playwright().start()
        try:
            self._context = self._playwright.chromium.launch_persistent_context(
                str(self.profile_dir),
                headless=headless,
                locale="en-US",
                args=["--disable-blink-features=AutomationControlled"],
                ignore_default_args=["--enable-automation"],
            )
        except Exception as exc:
            self._playwright.stop()
            raise RuntimeError(
                "Could not launch Chromium for browser transport. Run "
                "`.venv/bin/playwright install chromium`, then try again."
            ) from exc
        self._page = self._context.pages[0] if self._context.pages else self._context.new_page()

    def open_for_manual_setup(
        self, url: str = "https://www.novelupdates.com/"
    ) -> None:
        self._page.goto(url, wait_until="domcontentloaded")

    def fetch(
        self,
        url: str,
        *,
        post_data: Optional[Dict] = None,
        timeout: float = 30.0,
    ) -> Tuple[Optional[str], int]:
        timeout_ms = int(timeout * 1000)
        if post_data:
            result = self._page.evaluate(
                """
                async ({url, data}) => {
                  const response = await fetch(url, {
                    method: "POST",
                    headers: {"Content-Type": "application/x-www-form-urlencoded"},
                    body: new URLSearchParams(data),
                    credentials: "include"
                  });
                  return {status: response.status, text: await response.text()};
                }
                """,
                {"url": url, "data": post_data},
            )
            return result["text"], int(result["status"])
        response = self._page.goto(
            url, wait_until="domcontentloaded", timeout=timeout_ms
        )
        if response is None:
            return None, 500
        # Use the original response body (important for robots.txt) rather than
        # Chromium's rendered HTML wrapper for text/plain resources.
        return response.text(), response.status

    def close(self) -> None:
        self._context.close()
        self._playwright.stop()


class CloudflareChallengeError(RuntimeError):
    """Raised when a Cloudflare challenge cannot be cleared automatically."""


class CloudflareBrowserTransport:
    """Browser transport that automatically clears Cloudflare challenges.

    NovelUpdates serves its /series/* detail pages behind Cloudflare's managed
    JS challenge, which no pure-HTTP client can pass. This transport drives a
    real Chromium (via Playwright), waits for the challenge to auto-resolve,
    and persists the resulting clearance cookies to disk so subsequent runs
    (and restarts) reuse them until Cloudflare decides to re-challenge.

    Everything still goes through ScraperClient, so polite delays, caching,
    and retry behavior are unchanged. Slower per-request than curl_cffi, but
    it actually gets the page.
    """

    COOKIE_FILE_NAME = "cf_clearance_cookies.json"

    def __init__(
        self,
        profile_dir: Path = DEFAULT_BROWSER_PROFILE,
        *,
        headless: bool = False,
        challenge_timeout: float = 60.0,
        cookie_file: Optional[Path] = None,
    ):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            raise RuntimeError(
                "Cloudflare browser transport requires Playwright. Install it with "
                "`.venv/bin/pip install playwright` and then "
                "`.venv/bin/playwright install chromium`."
            ) from exc

        self.profile_dir = Path(profile_dir).expanduser().resolve()
        self.profile_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.profile_dir, 0o700)
        self.headless = headless
        self.challenge_timeout = challenge_timeout
        self.cookie_file = (
            Path(cookie_file).expanduser()
            if cookie_file
            else self.profile_dir.parent / self.COOKIE_FILE_NAME
        )
        self._playwright = sync_playwright().start()
        try:
            self._context = self._playwright.chromium.launch_persistent_context(
                str(self.profile_dir),
                headless=headless,
                locale="en-US",
                timezone_id="America/New_York",
                viewport={"width": 1366, "height": 768},
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
                ),
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                ],
                ignore_default_args=["--enable-automation"],
            )
            self._context.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
            )
        except Exception:
            self._playwright.stop()
            raise
        self._page = self._context.pages[0] if self._context.pages else self._context.new_page()
        self._load_cookies()

    # -- cookie persistence -------------------------------------------------
    def _load_cookies(self) -> None:
        try:
            raw = self.cookie_file.read_text()
        except OSError:
            return
        try:
            cookies = json.loads(raw)
        except ValueError:
            return
        if cookies:
            try:
                self._context.add_cookies(cookies)
            except Exception:
                pass

    def _save_cookies(self) -> None:
        try:
            cookies = self._context.cookies()
            self.cookie_file.write_text(json.dumps(cookies))
            os.chmod(self.cookie_file, 0o600)
        except OSError:
            pass

    # -- challenge handling -------------------------------------------------
    def _challenge_present(self) -> bool:
        try:
            title = self._page.title() or ""
        except Exception:
            return True
        if "just a moment" in title.lower():
            return True
        try:
            return contains_challenge(self._page.content())
        except Exception:
            return True

    def _wait_for_clearance(self) -> bool:
        """Wait for Cloudflare to clear; True when the real page is showing."""
        deadline = time.time() + self.challenge_timeout
        while time.time() < deadline:
            if not self._challenge_present():
                self._save_cookies()
                return True
            time.sleep(2.0)
        return not self._challenge_present()

    def fetch(
        self,
        url: str,
        *,
        post_data: Optional[Dict] = None,
        timeout: float = 30.0,
    ) -> Tuple[Optional[str], int]:
        timeout_ms = int(timeout * 1000)
        try:
            if post_data:
                # POST through page JS so clearance cookies are attached.
                result = self._page.evaluate(
                    """
                    async ({url, data}) => {
                      const response = await fetch(url, {
                        method: "POST",
                        headers: {"Content-Type": "application/x-www-form-urlencoded"},
                        body: new URLSearchParams(data),
                        credentials: "include"
                      });
                      return {status: response.status, text: await response.text()};
                    }
                    """,
                    {"url": url, "data": post_data},
                )
                text, status = result["text"], int(result["status"])
                if contains_challenge(text):
                    raise CloudflareChallengeError(
                        f"Cloudflare challenge on POST {url}; solve it in the "
                        "visible browser window, then retry."
                    )
                return text, status
            response = self._page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            if response is None:
                return None, 500
            if self._challenge_present() and not self._wait_for_clearance():
                raise CloudflareChallengeError(
                    f"Cloudflare challenge did not clear for {url} within "
                    f"{self.challenge_timeout:.0f}s. If a checkbox/captcha is showing, "
                    "complete it once in the visible browser window; the clearance "
                    "cookies will be saved and reused."
                )
            return self._page.content(), response.status
        except CloudflareChallengeError:
            raise
        except Exception as exc:
            print(f"[CloudflareBrowserTransport Error] {url}: {exc}")
            return None, 500

    def close(self) -> None:
        try:
            self._save_cookies()
            self._context.close()
        finally:
            self._playwright.stop()


class WaybackTransport:
    """Serve pages from the Wayback Machine when direct fetches are challenged.

    NovelUpdates puts its /series/* pages behind Cloudflare's JS challenge.
    The Wayback Machine has archived snapshots of most series pages (popular
    titles often have a snapshot within the last month). This transport tries
    the primary HTTP transport first and falls back to the latest archived
    snapshot when the live page is challenged.

    Trade-off: snapshot data lags the live site (days to months depending on
    the title's popularity). The snapshot timestamp is exposed via
    ``last_snapshot_date`` / ``last_source`` after each fetch so callers can
    record provenance.
    """

    TIMEMAP_URL = "https://web.archive.org/web/timemap/link/"

    def __init__(self, primary: Optional[FetchTransport] = None, headers: Optional[Dict[str, str]] = None):
        from curl_cffi import requests

        self.primary = primary
        self.headers = headers or {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            )
        }
        self._session = requests.Session(impersonate="chrome124")
        self.last_source = "live"  # "live" or "wayback"
        self.last_snapshot_date: Optional[str] = None  # YYYYMMDDHHMMSS

    def _latest_snapshot(self, url: str) -> Optional[str]:
        try:
            r = self._session.get(self.TIMEMAP_URL + url, headers=self.headers, timeout=30)
            if r.status_code != 200:
                return None
            mementos = [
                line.split(";")[0].strip().strip("<>")
                for line in r.text.splitlines()
                if 'rel="memento"' in line
            ]
            return mementos[-1] if mementos else None
        except Exception:
            return None

    def fetch(
        self,
        url: str,
        *,
        post_data: Optional[Dict] = None,
        timeout: float = 30.0,
    ) -> Tuple[Optional[str], int]:
        self.last_source = "live"
        self.last_snapshot_date = None
        if self.primary is not None and not post_data:
            text, status = self.primary.fetch(url, timeout=timeout)
            if text is not None and not contains_challenge(text):
                return text, status
        # fall back to the newest archived snapshot (original HTML, no toolbar)
        memento = self._latest_snapshot(url)
        if not memento:
            return None, 404
        # insert id_ to get the original archived bytes instead of the toolbar rewrite
        parts = memento.split("/web/", 1)
        if len(parts) != 2 or "/" not in parts[1]:
            return None, 404
        ts, rest = parts[1].split("/", 1)
        replay_url = parts[0] + "/web/" + ts + "id_/" + rest
        try:
            r = self._session.get(replay_url, headers=self.headers, timeout=timeout)
            if r.status_code != 200 or contains_challenge(r.text):
                return None, 404
            self.last_source = "wayback"
            self.last_snapshot_date = ts
            return r.text, 200
        except Exception as exc:
            print(f"[WaybackTransport Error] {url}: {exc}")
            return None, 500

    def close(self) -> None:
        if self.primary is not None:
            self.primary.close()
        self._session.close()


class CurlCffiTransport:
    def __init__(self, headers: Dict[str, str], impersonate: str = "chrome124"):
        from curl_cffi import requests
        self.headers = headers
        self.impersonate = impersonate
        self.session = requests.Session(impersonate=self.impersonate)

    def fetch(
        self,
        url: str,
        *,
        post_data: Optional[Dict] = None,
        timeout: float = 30.0,
    ) -> Tuple[Optional[str], int]:
        try:
            if post_data:
                r = self.session.post(url, data=post_data, headers=self.headers, timeout=timeout)
            else:
                r = self.session.get(url, headers=self.headers, timeout=timeout)
            return r.text, r.status_code
        except Exception as e:
            print(f"[CurlCffiTransport Error] {url}: {e}")
            return None, 500

    def close(self) -> None:
        if hasattr(self, "session"):
            self.session.close()


class UrllibTransport:
    def __init__(self, headers: Dict[str, str]):
        self.headers = headers

    def fetch(
        self,
        url: str,
        *,
        post_data: Optional[Dict] = None,
        timeout: float = 30.0,
    ) -> Tuple[Optional[str], int]:
        req = urllib.request.Request(url, headers=self.headers)
        if post_data:
            req.data = urllib.parse.urlencode(post_data).encode("utf-8")
            req.add_header(
                "Content-Type", "application/x-www-form-urlencoded"
            )
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return (
                response.read().decode("utf-8", errors="replace"),
                response.status,
            )

    def close(self) -> None:
        return None

class ScraperClient:
    def __init__(
        self,
        cache_dir: str = CACHE_DIR,
        delay_range: Tuple[float, float] = (3.0, 6.0),
        timeout: float = 30.0,
        transport: Optional[FetchTransport] = None,
    ):
        self.cache_dir = cache_dir
        self.delay_range = delay_range
        self.timeout = timeout
        os.makedirs(self.cache_dir, exist_ok=True)
        self.headers = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
        if transport:
            self.transport = transport
        else:
            try:
                self.transport = CurlCffiTransport(self.headers)
            except Exception:
                self.transport = UrllibTransport(self.headers)

    def _get_cache_key(self, url: str, post_data: Optional[Dict] = None) -> str:
        key_str = url
        if post_data:
            key_str += f"?{urllib.parse.urlencode(sorted(post_data.items()))}"
        return hashlib.sha256(key_str.encode('utf-8')).hexdigest()

    def fetch(self, url: str, post_data: Optional[Dict] = None, use_cache: bool = True) -> Tuple[Optional[str], int, bool]:
        """
        Fetches a URL or POST request with local response caching.
        Returns: (content_text, status_code, from_cache)
        """
        cache_key = self._get_cache_key(url, post_data)
        cache_path = os.path.join(self.cache_dir, f"{cache_key}.txt")

        if use_cache and os.path.exists(cache_path):
            with open(cache_path, 'r', encoding='utf-8') as f:
                return f.read(), 200, True

        # Polite delay before network request
        delay = random.uniform(*self.delay_range)
        time.sleep(delay)

        try:
            content_text, status_code = self.transport.fetch(
                url, post_data=post_data, timeout=self.timeout
            )
            if content_text is None:
                return None, status_code, False
            if contains_challenge(content_text):
                print(f"[WARNING] Potential CAPTCHA/Block detected at {url}")
                return None, 403, False

            # Save atomically so an interrupted run cannot leave a valid-looking
            # truncated cache entry.
            if use_cache and status_code == 200:
                fd, temp_path = tempfile.mkstemp(
                    prefix=".response-", dir=self.cache_dir, text=True
                )
                try:
                    with os.fdopen(fd, "w", encoding="utf-8") as f:
                        f.write(content_text)
                        f.flush()
                        os.fsync(f.fileno())
                    os.replace(temp_path, cache_path)
                finally:
                    if os.path.exists(temp_path):
                        os.unlink(temp_path)

            return content_text, status_code, False

        except urllib.error.HTTPError as e:
            print(f"[HTTPError {e.code}] {url}")
            return None, e.code, False
        except Exception as e:
            print(f"[RequestError] {url}: {e}")
            return None, 500, False

    def close(self) -> None:
        self.transport.close()
