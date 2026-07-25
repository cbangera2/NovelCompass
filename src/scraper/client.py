import os
import hashlib
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
