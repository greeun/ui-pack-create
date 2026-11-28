#!/usr/bin/env python3
"""Self-check for instagram-post.py. Run: python3 scripts/test_instagram_post.py"""
import importlib.util, json, os

spec = importlib.util.spec_from_file_location("ip", os.path.join(os.path.dirname(__file__), "instagram-post.py"))
assert spec and spec.loader
ip = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ip)

# URL forms: query dropped, /p/, /reel/ and /<user>/p/ accepted, non-post URLs refused
assert ip.parse_url("https://www.instagram.com/p/DgIc_x-8N/?img_index=2&lqvp=abc") == ("DgIc_x-8N", "https://www.instagram.com/p/DgIc_x-8N/")
assert ip.parse_url("https://instagram.com/reel/AbC1/") == ("AbC1", "https://www.instagram.com/p/AbC1/")
assert ip.parse_url("https://www.instagram.com/some.user/p/AbC1") == ("AbC1", "https://www.instagram.com/p/AbC1/")
for bad in ("https://www.instagram.com/some.user/", "http://www.instagram.com/p/X/", "https://evil.com/p/X/", "https://www.threads.com/t/X"):
    try:
        ip.parse_url(bad)
        raise AssertionError(bad)
    except ValueError:
        pass


def page(post):
    """The embed page holds the post as a JSON string inside a JSON object, as Instagram serves it."""
    inner = json.dumps({"context": {"type": "x"}, "gql_data": {"shortcode_media": post}})
    return '<script>s.handle({"isSidecar":true,"contextJSON":' + json.dumps(inner) + ',"x":1});</script>'


cap = {"edge_media_to_caption": {"edges": [{"node": {"text": "Title\nline two "}}]}, "owner": {"username": "studio"}}
img = lambda n: {"is_video": False, "display_url": f"https://scontent-x.cdninstagram.com/{n}.jpg?a=1&b=2"}

# Carousel: order kept, video item uses video_url, items from other hosts or without an address are skipped
carousel = {**cap, "is_video": False, "display_url": "https://scontent-x.cdninstagram.com/cover.jpg",
            "edge_sidecar_to_children": {"edges": [{"node": img(1)},
                                                   {"node": {"is_video": True, "display_url": "https://x.fbcdn.net/p.jpg", "video_url": "https://x.fbcdn.net/v.mp4"}},
                                                   {"node": {"is_video": False, "display_url": "https://evil.com/i.jpg"}},
                                                   {"node": {"is_video": True, "display_url": "https://x.fbcdn.net/p.jpg"}}]}}
caption, uploader, media, skipped = ip.parse_embed(page(carousel))
assert (caption, uploader) == ("Title\nline two", "studio"), (caption, uploader)
assert media == [("https://scontent-x.cdninstagram.com/1.jpg?a=1&b=2", "jpg"), ("https://x.fbcdn.net/v.mp4", "mp4")], media
assert skipped == ["item 3: image without a usable address", "item 4: video without a usable address"], skipped

# Single image post: the post itself is the one item
assert ip.parse_embed(page({**cap, **img("only")}))[2] == [("https://scontent-x.cdninstagram.com/only.jpg?a=1&b=2", "jpg")]

# Pages without post data: nothing, no exception
assert ip.parse_embed("<html>Log in</html>") == ("", None, [], [])
assert ip.parse_embed(page(None)) == ("", None, [], [])
assert ip.parse_embed('"contextJSON":"{broken') == ("", None, [], [])
print("ok")
