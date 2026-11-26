# ui-pack-create

A Claude Code skill that makes and edits UI design system packs.

A UI pack is a folder that holds one screen design: color, type and spacing tokens, fonts, components, motion, a design guide, a gallery page and the tests that check them. This skill makes a pack in one of two ways:

- **From source code** (`extract.md`): classify the shared UI code of an existing project, copy what is not tied to the business, and wire the app-specific values into one configuration file.
- **Without source code** (`from-site.md`): from a website URL, an SNS post link, screenshots, images or video. Values are measured, the design guide is written, and the components are written from scratch. Nothing is copied from the original's code.

It also syncs a pack with its source project and edits existing packs. Applying a pack to a project is the job of the companion skill.

## Companion skill (required)

This skill depends on [ui-pack](https://github.com/greeun/ui-pack). `ui-pack` provides the pack format reference, the component catalog, the installer, the pack viewer builder and the gallery check that the documents here call. Install both.

## Install

```bash
git clone https://github.com/greeun/ui-pack-create.git
ln -s "$(pwd)/ui-pack-create" ~/.claude/skills/ui-pack-create
```

Install `ui-pack` the same way, linked as `~/.claude/skills/ui-pack`.

## Where packs live

Packs are kept in a pack store, not inside the skills:

- default: `~/.axt/vault/ui-pack/packs/<pack>/`
- override: set the environment variable `UI_PACK_HOME`; packs are then in `$UI_PACK_HOME/packs/<pack>/`

If the pack store is a git repository, the skill works in a worktree or branch of it and asks before merging.

## Requirements

- Node 22 or later
- Python 3 with Pillow (`pip install pillow`)
- pnpm (for the empty Next.js test project)
- Google Chrome (the scripts start it headless; the path is the macOS default and is set at the top of `scripts/cdp.mjs`)
- `ffmpeg` and `yt-dlp` for video and SNS post input

## Scripts

| Script | What it does |
| --- | --- |
| `scripts/site-collect.mjs` | Collects computed styles and screenshots of up to three pages (read-only). Refuses blocked services, paths disallowed by `robots.txt` and pages behind a login (exit code 3) |
| `scripts/site-fidelity.mjs` | Compares the values that repeat in the collected pages with the pack gallery, per style family |
| `scripts/origin-check.mjs` | Checks the origin record in `pack.json`; for an inspired pack, that no source name, proprietary font or brand color remains |
| `scripts/shot-compare.py` | Compares a source image with a capture of a screen redrawn from pack components |
| `scripts/image-colors.py` | Measures colors in regions of an image |
| `scripts/threads-post.py` | Fetches the caption, video and images of one public Threads post from its embed page (yt-dlp has no Threads extractor). No login, no cookies |
| `scripts/source-changes.py` | Lists source files that changed since the pack was extracted |
| `scripts/cdp.mjs` | Shared Chrome DevTools Protocol helpers used by the three `.mjs` scripts |

## Responsible use

- **Respect collection rules.** `site-collect.mjs` does not collect from services that forbid automated collection, from paths that `robots.txt` disallows, or from pages behind a login. There is no option to skip these checks, and the skill does not use other tools to get around a refusal. It asks you for screenshots instead.
- **Other people's designs become inspired packs only.** Unless you state that the original is yours or that you have permission, the skill makes an inspired pack: no product names, logos, illustrations or screen copy; brand colors shifted by 30° or more of hue angle; proprietary fonts replaced by open-license fonts. Only structure (spacing, radius, type scale, layout, how components are composed) is carried over as reference.
- **No copied assets.** Fonts and icons come from open-license sources at their official distribution, never from the original site.
- **Logins are yours to do.** The skill never asks for a password and does not use browser cookies to pass a login wall.

You are responsible for having the right to use any material you give the skill.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
