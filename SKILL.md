---
name: ui-pack-create
description: Use when making a new UI design system pack - from an existing project's source code, or without source from a website URL, SNS post link (reel, video), screenshot, image or video - or when syncing or editing an existing pack. Not for applying a pack to a project - that is the ui-pack skill. Triggers - "turn this project's UI into a pack", "make a pack", "make a pack from this site", "UI pack from this link", "pack from screenshots", "inspired pack", "sync the pack", "edit the pack", "/ui-pack-create".
---

# ui-pack-create

This skill makes and edits UI packs. Applying a pack to another project is the job of the `ui-pack` skill.

A UI pack is a folder that holds one screen design: color, type and spacing tokens, fonts, components, motion, the design guide, the gallery page and the tests that check them. Packs live in the pack store. The shared files that packs depend on live in the `ui-pack` skill.

`UI_PACK_HOME` is the pack store. It defaults to `~/.axt/vault/ui-pack` when the environment variable is not set.

| Location | Contents |
| --- | --- |
| `$UI_PACK_HOME/packs/<pack>/` | A pack. New packs are made here too. The pack index is `$UI_PACK_HOME/packs/index.html` |
| `~/.claude/skills/ui-pack/references/pack-format.md` | The reference for the pack format. An existing pack in the pack store is the best worked example when there is one |
| `~/.claude/skills/ui-pack/catalog.json` | The component catalog (the standard list of components). Each pack records a status per component in `components` of its `pack.json` |
| `~/.claude/skills/ui-pack/scripts/` | `install.py` (install), `build-view.py` (pack viewer), `gallery-check.mjs` (gallery comparison), `compare.py` (before/after comparison of an application) |
| `~/.claude/skills/ui-pack/viewer/` | The Next.js template that builds the pack viewer. The `next` version in `viewer/package.json` is the reference version for the empty test project |
| `~/.claude/skills/ui-pack-create/scripts/` | Tools used only when making packs: `site-collect.mjs`, `site-fidelity.mjs`, `origin-check.mjs`, `shot-compare.py`, `image-colors.py`, `cdp.mjs`, `source-changes.py` |

## Actions

| Request | Condition | Document to follow |
| --- | --- | --- |
| "Turn this project's UI into a pack", `/ui-pack-create extract <pack>` | The source code of the source project is available | [extract.md](extract.md) |
| "Make a pack from this site / link / screenshot", `/ui-pack-create from <URL or file>` | There is no source code (website URL, SNS post link, screenshot, image, video) | [from-site.md](from-site.md) |
| "Sync the pack", `/ui-pack-create sync <pack>` | The source of a pack extracted from source code has changed | "Sync" below |
| "Edit the pack" (change values, components or the design guide) | An existing pack is being edited | "Editing a pack" below |

When you receive both source code and a URL, the source code is the reference ([extract.md](extract.md)). Use the URL only to check the rendered screens.

## Common rules

- Packs are made and edited in the pack store. If the pack store (`$UI_PACK_HOME`) is a git repository, work in a worktree or branch of that repository and commit there. Other projects see the pack only after the branch is merged; ask the user when to merge. If the pack store is not a git repository, edit in place and say so in the report.
- While you work in a worktree of the pack store, the pack folder is the worktree's `packs/<pack>`. Pass that folder wherever a command below takes `<pack>` (a new pack and an edited pack exist only in the worktree until the merge).
- The skill files (`~/.claude/skills/ui-pack/`, `~/.claude/skills/ui-pack-create/`) are edited in their own repositories, not in the pack store. If an installed skill folder is a link into a repository's working tree, do not edit files through the link; work in a worktree or branch of that repository.
- After making or editing a pack, rebuild the pack viewer with `python3 ~/.claude/skills/ui-pack/scripts/build-view.py <pack>` and commit it together with the pack.
- When you add a component definition to `catalog.json`, also record that component as `absent` in the `pack.json` of every other pack and rebuild the pack viewers of those packs.
- The design quality review (an anti-slop review skill) is done only in this skill, when the pack is made. It is not done when a pack is applied.

## Editing a pack

1. Decide the value and the scope first. One token is used by several components (for example `--radius-pill` is shared by buttons, tags and count badges), so find every use with `grep`. If the request points at only some of them, ask the user how far the change should go.
2. For a pack that has a source repository (`source.repo` in `pack.json`), the source project is the reference. If the change should also land in the source, change the source first and bring it in with "Sync". If the change stays in the pack only, change the pack and record it in `changes` of `pack.json` as a "pack-only change" (so that the next sync does not revert it to the source value).
3. In the pack (in the worktree when the pack store is a git repository), change the value and every place that records it: `tokens/globals.css`, the components, the matching section of `guide/ui-direction.md`, the `tests/` that check the value, and `version` and `changes` in `pack.json`.
4. Verify: steps 1 and 2 of section 3 in [extract.md](extract.md) (install into an empty project, `tsc`, lint, `vitest`), `gallery-check.mjs` against `/design` of the test project, and look at the gallery captures yourself. Then rebuild the pack viewer with `build-view.py`.
5. Projects that already installed this pack are not updated automatically. After the change is merged (or saved in place), run `install.py` again in that project (it does not overwrite files that were edited after the install).

To try an edited pack before the merge, give `install.py` the pack folder in the worktree (`<worktree>/packs/<pack>`) as the pack path.

## Sync

Only for packs extracted from source code. A pack that has `origin` in `pack.json` (a pack made without source) has no source repository and is not synced.

1. Run `python3 ~/.claude/skills/ui-pack-create/scripts/source-changes.py <pack>` to see which files changed and which files were added in the source.
2. For each changed file, carry the diff into the pack, file by file. Do not carry over the source's business vocabulary or the source app's configuration values. Do not overwrite pack files with the source (that erases the pack-only wiring edits).
3. For each added file, decide whether to include it with the classification in [extract.md](extract.md).
4. Update `source.commit`, `version`, `sources` and `components` in `pack.json`.
5. Run the pack tests and `gallery-check.mjs`, and rebuild the pack viewer.
