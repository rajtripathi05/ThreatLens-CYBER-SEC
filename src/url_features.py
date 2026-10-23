"""Safe, offline URL parsing and lexical features. Nothing here touches the network."""
from __future__ import annotations

import ipaddress
import math
import re
from collections import Counter
from dataclasses import dataclass
from urllib.parse import urlsplit

SHORTENERS = {
    "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly",
    "rebrand.ly", "cutt.ly", "shorturl.at", "tiny.cc", "rb.gy",
}
SUSPICIOUS_TLDS = {"xyz", "top", "click", "tk", "ml", "ga", "cf", "gq", "zip", "mov", "icu", "buzz", "work"}
SENSITIVE_WORDS = (
    "login", "signin", "verify", "secure", "account", "update", "confirm",
    "password", "wallet", "banking", "suspend", "invoice",
)


@dataclass
class ParsedUrl:
    raw: str
    scheme: str
    host: str
    port: int | None
    path: str
    query: str
    valid: bool
    error: str = ""


def parse_url(raw: str) -> ParsedUrl:
    """Parse defensively; never raises."""
    raw = (raw or "").strip()
    candidate = raw if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", raw) else "http://" + raw
    try:
        parts = urlsplit(candidate)
        host = (parts.hostname or "").lower().rstrip(".")
        port = parts.port
    except ValueError as exc:
        return ParsedUrl(raw, "", "", None, "", "", False, str(exc))
    if not host:
        return ParsedUrl(raw, parts.scheme, "", port, parts.path, parts.query, False, "no host")
    return ParsedUrl(raw, parts.scheme.lower() if "://" in raw else "", host, port, parts.path, parts.query, True)


def normalize_url(raw: str) -> str:
    """Normalised form used for exact indicator matching.

    Lower-cased host, scheme ignored, default ports and fragment dropped, trailing '/' on a
    bare path dropped. Path and query case are preserved.
    """
    p = parse_url(raw)
    if not p.valid:
        return (raw or "").strip().lower()
    port = f":{p.port}" if p.port and p.port not in (80, 443) else ""
    path = "" if p.path in ("", "/") else p.path
    query = f"?{p.query}" if p.query else ""
    return f"{p.host}{port}{path}{query}"


def is_ip_host(host: str) -> bool:
    try:
        ipaddress.ip_address(host.strip("[]"))
        return True
    except ValueError:
        return False


def display_host(host: str) -> str:
    """Return the Unicode form of a punycode host (for analyst display only)."""
    try:
        return host.encode("ascii").decode("idna")
    except (UnicodeError, UnicodeDecodeError):
        return host


def registered_tld(host: str) -> str:
    return host.rsplit(".", 1)[-1] if "." in host else ""


def _entropy(s: str) -> float:
    if not s:
        return 0.0
    n = len(s)
    return -sum(c / n * math.log2(c / n) for c in Counter(s).values())


def lexical_features(raw: str) -> dict[str, float | bool | str]:
    p = parse_url(raw)
    host = p.host
    labels = host.split(".") if host else []
    url = raw or ""
    return {
        "valid": p.valid,
        "host": host,
        "length": len(url),
        "host_length": len(host),
        "num_dots_host": host.count("."),
        "num_subdomains": max(len(labels) - 2, 0),
        "num_hyphens_host": host.count("-"),
        "num_digits": sum(ch.isdigit() for ch in url),
        "has_at": "@" in url.split("?")[0],
        "is_ip": is_ip_host(host),
        "is_punycode": any(lab.startswith("xn--") for lab in labels),
        "has_non_ascii_host": any(ord(ch) > 127 for ch in host),
        "is_shortener": host in SHORTENERS,
        "suspicious_tld": registered_tld(host) in SUSPICIOUS_TLDS,
        "uses_https": p.scheme == "https",
        "explicit_http": p.scheme == "http",
        "nonstandard_port": bool(p.port and p.port not in (80, 443)),
        "sensitive_words": sum(w in url.lower() for w in SENSITIVE_WORDS),
        "path_entropy": round(_entropy(p.path + p.query), 3),
        "query_length": len(p.query),
    }
