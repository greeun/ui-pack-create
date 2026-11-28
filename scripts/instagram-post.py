#!/usr/bin/env python3
"""Fetches the content of one public Instagram post (caption, images, video). yt-dlp gets only the caption of image and carousel posts ("No video formats found"), so from-site.md uses this for them.

Usage: python3 instagram-post.py <Instagram post URL> <collection dir>
URL forms: https://www.instagram.com/p/<ID>/, https://www.instagram.com/reel/<ID>/ (the query, such as ?img_index=2, is dropped)

Reads only the public embed page that Instagram offers for embedding a post on other sites (/p/<ID>/embed/captioned/). No login, no cookies.
Output, in the same layout as the yt-dlp command in from-site.md:
  <dir>/post.jpg (or post-1.jpg, post-2.mp4 ... in carousel order when there are several media files)
  <dir>/post.info.json   {"description": caption, "uploader", "webpage_url", "id", "extractor": "instagram-embed", "files", "skipped"}
Exit code 3: nothing to collect (post is private, deleted, or the embed page changed). Ask the user for the files instead.
"""
import json, os, re, sys, urllib.request
from urllib.parse import urlsplit

MEDIA_HOSTS = (".cdninstagram.com", ".fbcdn.net")


def parse_url(url):
    u = urlsplit(url.strip())
    if u.scheme != "https" or u.hostname not in ("instagram.com", "www.instagram.com"):
        raise ValueError(f"not an Instagram URL: {url}")
    m = re.fullmatch(r"/(?:[\w.]+/)?(?:p|reel|reels|tv)/([\w-]+)/?", u.path)
    if not m:
        raise ValueError(f"not an Instagram post URL (needs a post ID): {url}")
    pid = m.group(1)
    # The query is dropped: it carries the tracking value of the account that shared the link.
    return pid, f"https://www.instagram.com/p/{pid}/"


def parse_embed(html):
    """Returns (caption, uploader, media, skipped). media: [(url, ext)], skipped: notes on items that had no file."""
    key = '"contextJSON":'
    i = html.find(key)
    if i < 0:
        return "", None, [], []
    try:
        raw, _ = json.JSONDecoder().raw_decode(html, i + len(key))
        post = json.loads(raw)["gql_data"]["shortcode_media"]
    except (ValueError, KeyError, TypeError):
        return "", None, [], []
    if not post:
        return "", None, [], []
    edges = (post.get("edge_media_to_caption") or {}).get("edges") or []
    caption = edges[0]["node"].get("text", "") if edges else ""
    uploader = (post.get("owner") or {}).get("username")
    nodes = [e["node"] for e in (post.get("edge_sidecar_to_children") or {}).get("edges") or []] or [post]
    media, skipped = [], []
    for n, node in enumerate(nodes, 1):
        src, ext = (node.get("video_url"), "mp4") if node.get("is_video") else (node.get("display_url"), "jpg")
        host = urlsplit(src or "").hostname or ""
        if src and src.startswith("https://") and host.endswith(MEDIA_HOSTS):
            media.append((src, ext))
        else:
            skipped.append(f"item {n}: {'video' if node.get('is_video') else 'image'} without a usable address")
    return caption.strip(), uploader, media, skipped


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.read()


def main():
    if len(sys.argv) != 3:
        print((__doc__ or "").split("\n\n")[1], file=sys.stderr)
        sys.exit(2)
    try:
        pid, post_url = parse_url(sys.argv[1])
    except ValueError as e:
        print(e, file=sys.stderr)
        sys.exit(2)
    out = sys.argv[2]
    stop = "→ Ask the user to save the post's images or video and send them as files, with the caption text (from-site.md section 2)."
    try:
        html = get(post_url + "embed/captioned/").decode("utf-8", "replace")
    except Exception as e:
        print(f"Not collecting: could not read the embed page ({e})\n{stop}", file=sys.stderr)
        sys.exit(3)
    caption, uploader, media, skipped = parse_embed(html)
    if not caption and not media:
        print(f"Not collecting: no caption or media on the embed page (private, deleted, or the page layout changed)\n{stop}", file=sys.stderr)
        sys.exit(3)
    os.makedirs(out, exist_ok=True)
    files = []
    for i, (src, ext) in enumerate(media, 1):
        name = f"post.{ext}" if len(media) == 1 else f"post-{i}.{ext}"
        with open(os.path.join(out, name), "wb") as f:
            f.write(get(src))
        files.append(name)
    info = {"id": pid, "uploader": uploader, "webpage_url": post_url, "description": caption,
            "extractor": "instagram-embed", "files": files, "skipped": skipped}
    with open(os.path.join(out, "post.info.json"), "w", encoding="utf-8") as f:
        json.dump(info, f, ensure_ascii=False, indent=2)
    print(json.dumps(info, ensure_ascii=False, indent=2))
    if skipped or not media:
        print(f"Some items have no file (see skipped).\n{stop}", file=sys.stderr)


if __name__ == "__main__":
    main()
