#!/usr/bin/env python3
"""Self-check for threads-post.py. Run: python3 scripts/test_threads_post.py"""
import importlib.util, os

spec = importlib.util.spec_from_file_location("tp", os.path.join(os.path.dirname(__file__), "threads-post.py"))
tp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tp)

# URL forms: query dropped, both hosts and both path shapes accepted, non-post URLs refused
assert tp.parse_url("https://www.threads.com/@a.b/post/XyZ_1?xmt=abc") == ("a.b", "XyZ_1", "https://www.threads.com/@a.b/post/XyZ_1")
assert tp.parse_url("https://threads.net/t/XyZ_1/") == (None, "XyZ_1", "https://www.threads.com/t/XyZ_1")
for bad in ("https://www.threads.com/@a.b", "https://www.instagram.com/p/X/", "http://www.threads.com/t/X", "https://evil.com/t/X"):
    try:
        tp.parse_url(bad)
        raise AssertionError(bad)
    except ValueError:
        pass

# Embed page: caption kept with line breaks, profile picture outside the media container ignored,
# media from other hosts dropped, duplicates removed
html = """
<div class="HeaderContainer"><img class="img" src="https://scontent.cdninstagram.com/p.jpg" width="36"></div>
<div class="BodyTextContainer"><span>Line one &amp; more<br>line two</span></div>
<div class="SoloMediaContainer"><div class="SingleInnerMediaContainerVideo">
  <video><source src="https://scontent-x.cdninstagram.com/v.mp4?a=1&amp;b=2"></video></div></div>
<div class="CarouselMediaContainer"><img src="https://scontent-x.fbcdn.net/i.jpg?x=1"><img src="https://evil.com/i.jpg">
  <img src="https://scontent-x.fbcdn.net/i.jpg?x=1"></div>
"""
caption, media = tp.parse_embed(html)
assert caption == "Line one & more\nline two", caption
assert media == ["https://scontent-x.cdninstagram.com/v.mp4?a=1&b=2", "https://scontent-x.fbcdn.net/i.jpg?x=1"], media
assert [tp.ext_of(m) for m in media] == ["mp4", "jpg"]
assert tp.parse_embed("<html><body>Log in</body></html>") == ("", [])
print("ok")
