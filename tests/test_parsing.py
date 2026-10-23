import pytest

from src import email_parser, indicator_rules, url_extractor
from src.url_features import display_host, normalize_url, parse_url

PLAIN_HTML = (b"From: a@x.example\r\nReply-To: b@y.example\r\nSubject: hi\r\nMIME-Version: 1.0\r\n"
              b"Content-Type: multipart/alternative; boundary=B\r\n\r\n--B\r\nContent-Type: text/plain\r\n\r\n"
              b"see http://plain.example/a.\r\n--B\r\nContent-Type: text/html\r\n\r\n"
              b"<a href=\"http://html.example/b\">http://other.example/</a>\r\n--B--\r\n")


def test_extract_from_text_strips_punctuation_and_refangs():
    urls = [u.url for u in url_extractor.extract_from_text("go to hxxp://bad[.]example/x, or www.foo.example/y).")]
    assert urls == ["http://bad.example/x", "www.foo.example/y"]


def test_eml_plain_and_html_parts():
    p = email_parser.parse_eml(PLAIN_HTML)
    found = {u.url for u in p.urls}
    assert {"http://plain.example/a", "http://html.example/b"} <= found
    assert any("other.example" in s.detail for s in email_parser.email_signals(p) if s.name == "link_text_mismatch")
    assert p.auth == {"spf": "not available", "dkim": "not available", "dmarc": "not available"}


def test_missing_auth_is_not_available_not_fail():
    p = email_parser.parse_eml(b"Subject: x\r\n\r\nbody")
    assert all(v == "not available" for v in p.auth.values())
    assert not [s for s in email_parser.email_signals(p) if "fail" in s.name]


def test_auth_results_parsed():
    p = email_parser.parse_eml(b"Authentication-Results: mx; spf=pass; dkim=fail; dmarc=pass\r\n\r\nx")
    assert p.auth == {"spf": "pass", "dkim": "fail", "dmarc": "pass"}


@pytest.mark.parametrize("data", [b"", b"   \r\n", b"\x00\xff\xfe garbage", b"From: =?bad?q?\xff\r\n\r\nhttp://a.example/",
                                  b"Subject\r\nno colon header\r\n\r\nbody"])
def test_malformed_and_empty_input_never_crashes(data):
    p = email_parser.parse_eml(data)
    assert isinstance(p.urls, list)


def test_oversize_rejected():
    with pytest.raises(email_parser.EmailTooLarge):
        email_parser.parse_eml(b"a" * (3 * 1024 * 1024))


def test_attachments_listed_not_opened():
    raw = (b"Subject: a\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=B\r\n\r\n--B\r\n"
           b"Content-Type: text/plain\r\n\r\nhi\r\n--B\r\nContent-Type: application/zip\r\n"
           b"Content-Disposition: attachment; filename=x.zip\r\nContent-Transfer-Encoding: base64\r\n\r\nUEsDBA==\r\n--B--\r\n")
    p = email_parser.parse_eml(raw)
    assert p.attachments[0]["filename"] == "x.zip"


def names(url):
    return {s.name for s in indicator_rules.evaluate_url_rules(url)}


def test_ip_literal():
    assert "ip_literal_host" in names("http://203.0.113.9/login")


def test_punycode_display():
    assert "punycode_or_unicode_host" in names("http://xn--pple-43d.example/")
    assert display_host("xn--pple-43d.example") != "xn--pple-43d.example"


def test_unicode_host():
    assert "punycode_or_unicode_host" in names("http://аpple.example/")


def test_shortener_is_heuristic():
    assert "url_shortener" in names("https://bit.ly/abc")


@pytest.mark.parametrize("u", ["http://[::1/login", "", "http://", "://", "http://a b.example:99999999/"])
def test_malformed_urls_do_not_raise(u):
    parse_url(u)
    normalize_url(u)
    indicator_rules.evaluate_url_rules(u)


def test_malformed_url_flagged():
    assert "malformed_url" in names("http://[::1/login")


def test_normalize_ignores_scheme_fragment_case_of_host():
    assert normalize_url("HTTPS://Fresh.Example/p#frag") == normalize_url("http://fresh.example/p") == "fresh.example/p"
