"""Parse .eml bytes with the standard library. Attachments are listed, never opened or executed."""
from __future__ import annotations

import re
from email import policy
from email.message import Message
from email.parser import BytesParser

from .config import MAX_UPLOAD_BYTES, MAX_URLS_PER_MESSAGE
from .schemas import ParsedEmail, Signal
from .url_extractor import anchor_mismatch, dedupe, extract_from_html, extract_from_text

NOT_AVAILABLE = "not available"
URGENCY_WORDS = ("urgent", "immediately", "verify your", "suspended", "act now", "confirm your",
                 "within 24 hours", "password expires")


class EmailTooLarge(ValueError):
    pass


def _hdr(msg: Message, name: str) -> str:
    try:
        v = msg.get(name)
        return "" if v is None else str(v)
    except Exception:  # malformed header values
        return ""


def _auth_results(msg: Message) -> dict[str, str]:
    blob = " ".join(_hdr(msg, h) for h in ("Authentication-Results", "Received-SPF"))
    out = {}
    for mech in ("spf", "dkim", "dmarc"):
        m = re.search(rf"\b{mech}\s*=\s*(\w+)", blob, re.I)
        if not m and mech == "spf":
            m = re.match(r"\s*(pass|fail|softfail|neutral|none)\b", _hdr(msg, "Received-SPF"), re.I)
        out[mech] = m.group(1).lower() if m else NOT_AVAILABLE
    return out


def _text_of(part: Message) -> str:
    try:
        return part.get_content()
    except Exception:
        try:
            payload = part.get_payload(decode=True) or b""
            return payload.decode(part.get_content_charset() or "utf-8", "replace")
        except Exception:
            return ""


def parse_eml(data: bytes) -> ParsedEmail:
    if len(data) > MAX_UPLOAD_BYTES:
        raise EmailTooLarge(f"File is {len(data)} bytes; limit is {MAX_UPLOAD_BYTES}.")
    result = ParsedEmail()
    if not data.strip():
        result.warnings.append("Empty input.")
        return result
    try:
        msg = BytesParser(policy=policy.default).parsebytes(data)
    except Exception as exc:
        result.warnings.append(f"Could not parse message: {exc}")
        return result
    for d in msg.defects:
        result.warnings.append(f"Message defect: {type(d).__name__}")
    result.subject = _hdr(msg, "Subject")
    result.from_header = _hdr(msg, "From")
    result.reply_to = _hdr(msg, "Reply-To")
    result.return_path = _hdr(msg, "Return-Path")
    result.date = _hdr(msg, "Date")
    result.message_id = _hdr(msg, "Message-ID")
    result.auth = _auth_results(msg)

    texts, htmls = [], []
    for part in msg.walk():
        if part.is_multipart():
            continue
        ctype = part.get_content_type()
        if part.get_content_disposition() == "attachment" or part.get_filename():
            try:
                size = len(part.get_payload(decode=True) or b"")
            except Exception:
                size = -1
            result.attachments.append({"filename": part.get_filename() or "(unnamed)",
                                       "content_type": ctype, "size": size})
            continue
        if ctype == "text/plain":
            texts.append(_text_of(part))
        elif ctype == "text/html":
            htmls.append(_text_of(part))
    result.text_body = "\n".join(texts)
    result.html_body = "\n".join(htmls)
    found = extract_from_html(result.html_body) + extract_from_text(result.text_body)
    result.urls = dedupe(found, MAX_URLS_PER_MESSAGE)
    return result


def _domain(addr: str) -> str:
    m = re.search(r"@([\w.-]+)", addr or "")
    return m.group(1).lower() if m else ""


def email_signals(e: ParsedEmail) -> list[Signal]:
    """Header/text heuristics. Reported separately from the URL classifier."""
    s: list[Signal] = []
    fd, rd = _domain(e.from_header), _domain(e.reply_to)
    if fd and rd and fd != rd:
        s.append(Signal("reply_to_mismatch", f"From domain '{fd}' differs from Reply-To domain '{rd}'.", "warn"))
    for mech, val in e.auth.items():
        if val in ("fail", "softfail"):
            s.append(Signal(f"{mech}_{val}", f"{mech.upper()} reported '{val}'.", "warn"))
    blob = f"{e.subject} {e.text_body}".lower()
    hits = [w for w in URGENCY_WORDS if w in blob]
    if hits:
        s.append(Signal("urgency_language", f"Urgency phrases: {', '.join(hits)}.", "info"))
    for u in e.urls:
        msg = anchor_mismatch(u)
        if msg:
            s.append(Signal("link_text_mismatch", msg, "warn"))
    if e.attachments:
        names = ", ".join(a["filename"] for a in e.attachments)
        s.append(Signal("has_attachments", f"Attachments listed only, not opened: {names}.", "info"))
    return s
