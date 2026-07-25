import os
import hashlib
import time
import random
import urllib.request
import urllib.parse
import urllib.error
import tempfile
from typing import Optional, Dict, Any, Tuple

CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "cache")

class ScraperClient:
    def __init__(
        self,
        cache_dir: str = CACHE_DIR,
        delay_range: Tuple[float, float] = (3.0, 6.0),
        timeout: float = 30.0,
    ):
        self.cache_dir = cache_dir
        self.delay_range = delay_range
        self.timeout = timeout
        os.makedirs(self.cache_dir, exist_ok=True)
        self.headers = {
            "User-Agent": (
                "NovelUpdatesRecommender/1.0 "
                "(personal local indexer; conservative cached crawler)"
            ),
            "Accept-Language": "en-US,en;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }

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
            req = urllib.request.Request(url, headers=self.headers)
            data_bytes = None
            if post_data:
                encoded = urllib.parse.urlencode(post_data).encode('utf-8')
                req.data = encoded
                req.add_header('Content-Type', 'application/x-www-form-urlencoded')

            with urllib.request.urlopen(req, timeout=self.timeout) as response:
                content_bytes = response.read()
                content_text = content_bytes.decode('utf-8', errors='replace')
                status_code = response.status

                # Detect CAPTCHA or blocking
                block_markers = (
                    "cf-browser-verification",
                    "cf-chl-",
                    "challenge-platform",
                    "<title>just a moment",
                    "verify you are human",
                    "unusual traffic from your computer network",
                )
                lowered = content_text.lower()
                if any(marker in lowered for marker in block_markers):
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
