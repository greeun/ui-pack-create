#!/usr/bin/env python3
"""Fetches the content of one public Threads post (caption, video, images). yt-dlp has no Threads extractor, so from-site.md uses this for Threads post URLs.

Usage: python3 threads-post.py <Threads post URL> <collection dir>
URL forms: https://www.threads.com/@<user>/post/<ID>, https://www.threads.com/t/<ID> (threads.net works too)

Reads only the public embed page that Threads offers for embedding a post on other sites (<post URL>/embed). No login, no cookies.
Output, in the same layout as the yt-dlp command in from-site.md:
  <dir>/post.mp4 (or post-1.mp4, post-2.jpg ... when there are several media files)
  <dir>/post.info.json   {"description": caption, "uploader", "webpage_url", "id", "extractor": "threads-embed", "files"}
Exit code 3: nothing to collect (post is private, deleted, or the embed page changed). Ask the user for the files instead.
"""
import json, os, re, sys, urllib.request
from html.parser import HTMLParser
from urllib.parse import urlsplit

MEDIA_HOSTS = (".cdninstagram.com", ".fbcdn.net")


def parse_url(url):
    u = urlsplit(url.strip())
    if u.scheme != "https" or u.hostname not in ("threads.com", "www.threads.com", "threads.net", "www.threads.net"):
        raise ValueError(f"not a Threads URL: {url}")
    m = re.fullmatch(r"/(?:@([\w.]+)/post|t)/([\w-]+)/?", u.path)
    if not m:
        raise ValueError(f"not a Threads post URL (needs a post ID): {url}")
    user, pid = m.groups()
    # The query is dropped: it carries the tracking value of the account that shared the link.
    path = f"/@{user}/post/{pid}" if user else f"/t/{pid}"
    return user, pid, f"https://www.threads.com{path}"


class EmbedParser(HTMLParser):
    """Collects the caption (BodyTextContainer) and the media inside *MediaContainer* elements."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []  # one entry per open element: "caption", "media" or None
        self.caption, self.media = [], []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class") or ""
        mark = "caption" if "BodyTextContainer" in cls else "media" if "MediaContainer" in cls else None
        if tag in ("img", "source", "br", "meta", "link", "input"):  # void elements
            if "media" in self.stack and a.get("src") and tag in ("img", "source"):
                self.media.append(a["src"])
            if tag == "br" and "caption" in self.stack:
                self.caption.append("\n")
            return
        self.stack.append(mark)

    def handle_endtag(self, tag):
        if self.stack:
            self.stack.pop()

    def handle_data(self, data):
        if "caption" in self.stack:
            self.caption.append(data)


def parse_embed(html):
    p = EmbedParser()
    p.feed(html)
    caption = re.sub(r"[ \t]+", " ", "".join(p.caption)).strip()
    media = []
    for src in p.media:
        host = urlsplit(src).hostname or ""
        if src.startswith("https://") and host.endswith(MEDIA_HOSTS) and src not in media:
            media.append(src)
    return caption, media


def get(url):
    # No browser User-Agent on purpose: with one, the embed page comes back as a script-only shell without the post.
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.read()


def ext_of(src):
    m = re.search(r"\.(mp4|jpg|jpeg|png|webp|heic)(?:\?|$)", urlsplit(src).path + "?")
    return m.group(1) if m else "bin"


def main():
    if len(sys.argv) != 3:
        print(__doc__.split("\n\n")[1], file=sys.stderr)
        sys.exit(2)
    try:
        user, pid, post_url = parse_url(sys.argv[1])
    except ValueError as e:
        print(e, file=sys.stderr)
        sys.exit(2)
    out = sys.argv[2]
    stop = "→ Ask the user to save the post's video or images and send them as files, with the caption text (from-site.md section 2)."
    try:
        html = get(post_url + "/embed").decode("utf-8", "replace")
    except Exception as e:
        print(f"Not collecting: could not read the embed page ({e})\n{stop}", file=sys.stderr)
        sys.exit(3)
    caption, media = parse_embed(html)
    if not caption and not media:
        print(f"Not collecting: no caption or media on the embed page (private, deleted, or the page layout changed)\n{stop}", file=sys.stderr)
        sys.exit(3)
    os.makedirs(out, exist_ok=True)
    files = []
    for i, src in enumerate(media, 1):
        name = f"post.{ext_of(src)}" if len(media) == 1 else f"post-{i}.{ext_of(src)}"
        with open(os.path.join(out, name), "wb") as f:
            f.write(get(src))
        files.append(name)
    info = {"id": pid, "uploader": user, "webpage_url": post_url, "description": caption, "extractor": "threads-embed", "files": files}
    with open(os.path.join(out, "post.info.json"), "w", encoding="utf-8") as f:
        json.dump(info, f, ensure_ascii=False, indent=2)
    print(json.dumps(info, ensure_ascii=False, indent=2))
    if not media:
        print(f"No media on the embed page (text-only post, or a media type the page does not show).\n{stop}", file=sys.stderr)


if __name__ == "__main__":
    main()
