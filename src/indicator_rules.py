"""Transparent lexical rules over URL features. These are heuristics shown next to the ML score."""
from __future__ import annotations

from .schemas import Signal
from .url_features import display_host, lexical_features, parse_url

_WEIGHTS = {
    "malformed_url": 0.5, "ip_literal_host": 0.35, "punycode_or_unicode_host": 0.25,
    "url_shortener": 0.2, "at_symbol": 0.3, "suspicious_tld": 0.15, "many_subdomains": 0.1,
    "hyphenated_host": 0.1, "sensitive_keywords": 0.15, "nonstandard_port": 0.1, "no_https": 0.05,
}


def evaluate_url_rules(raw: str) -> list[Signal]:
    f = lexical_features(raw)
    if not f["valid"]:
        return [Signal("malformed_url", "URL could not be parsed; treat with caution.", "warn")]
    s: list[Signal] = []
    host = str(f["host"])
    if f["is_ip"]:
        s.append(Signal("ip_literal_host", f"Host is an IP address ({host}).", "warn"))
    if f["is_punycode"] or f["has_non_ascii_host"]:
        s.append(Signal("punycode_or_unicode_host",
                        f"Host '{host}' displays as '{display_host(host)}'; check for look-alike characters.", "warn"))
    if f["is_shortener"]:
        s.append(Signal("url_shortener", f"{host} is a known URL shortener; the destination is hidden.", "warn"))
    if f["has_at"]:
        s.append(Signal("at_symbol", "'@' in the URL can disguise the real host.", "warn"))
    if f["suspicious_tld"]:
        s.append(Signal("suspicious_tld", f"TLD '.{host.rsplit('.', 1)[-1]}' is frequently abused (weak signal).", "info"))
    if f["num_subdomains"] >= 3:
        s.append(Signal("many_subdomains", f"{f['num_subdomains']} subdomain levels.", "info"))
    if f["num_hyphens_host"] >= 3:
        s.append(Signal("hyphenated_host", f"{f['num_hyphens_host']} hyphens in host.", "info"))
    if f["sensitive_words"] >= 2:
        s.append(Signal("sensitive_keywords", f"{f['sensitive_words']} credential/account keywords in URL.", "info"))
    if f["nonstandard_port"]:
        s.append(Signal("nonstandard_port", f"Port {parse_url(raw).port} is unusual.", "info"))
    if f["explicit_http"]:
        s.append(Signal("no_https", "Plain HTTP (weak signal).", "info"))
    return s


def heuristic_score(raw: str) -> float:
    """Lexical-only score in [0,1] (ablation baseline; not a probability)."""
    return float(min(1.0, sum(_WEIGHTS.get(sig.name, 0.0) for sig in evaluate_url_rules(raw))))
