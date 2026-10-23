"""Extract URL-like strings from text/HTML. Never resolves or requests them."""
from __future__ import annotations

import re
from html.parser import HTMLParser
from urllib.parse import urlsplit

from .schemas import ExtractedUrl

_URL_RE = re.compile(r"(?i)\b(?:https?://|www\.)[^\s<>\"'\]\[]+")
_TRAIL = ".,;:!?)}>'\""


def refang(text: str) -> str:
    return re.sub(r"(?i)\bhxxp(s?)://", r"http\1://", text).replace("[.]", ".").replace("(.)", ".")


class _AnchorParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.anchors: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self._href = dict(attrs).get("href") or ""
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self._href is not None:
            self.anchors.append((self._href, " ".join("".join(self._text).split())))
            self._href = None


def extract_from_text(text: str) -> list[ExtractedUrl]:
    return [ExtractedUrl(m.group(0).rstrip(_TRAIL), "text") for m in _URL_RE.finditer(refang(text or ""))]


def extract_from_html(html: str) -> list[ExtractedUrl]:
    parser = _AnchorParser()
    try:
        parser.feed(html or "")
        parser.close()
    except Exception:  # malformed markup must not crash analysis
        pass
    out = [ExtractedUrl(h.strip(), "html_href", t) for h, t in parser.anchors
           if re.match(r"(?i)^https?://", h.strip())]
    out += extract_from_text(re.sub(r"<[^>]+>", " ", html or ""))
    return out


def dedupe(urls: list[ExtractedUrl], limit: int | None = None) -> list[ExtractedUrl]:
    seen: set[str] = set()
    out: list[ExtractedUrl] = []
    for u in urls:
        key = u.url.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(u)
        if limit and len(out) >= limit:
            break
    return out


def anchor_mismatch(u: ExtractedUrl) -> str | None:
    """If anchor text looks like a URL for a different host than the href, describe it."""
    if u.source != "html_href" or not re.match(r"(?i)^(https?://|www\.)", u.anchor_text):
        return None
    try:
        shown = urlsplit(u.anchor_text if "://" in u.anchor_text else "http://" + u.anchor_text).hostname
        real = urlsplit(u.url).hostname
    except ValueError:
        return None
    if shown and real and shown.lower() != real.lower():
        return f"Link text shows '{shown}' but points to '{real}'."
    return None
