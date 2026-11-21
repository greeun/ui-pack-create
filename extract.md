# Making a new pack from source code (extract)

The source project is read-only. Make the pack in the pack store at `$UI_PACK_HOME/packs/<pack>/` (`UI_PACK_HOME` defaults to `~/.axt/vault/ui-pack`). If the pack store is a git repository, work in a worktree or branch of it, as the common rules in [SKILL.md](SKILL.md) say. Name the pack after the character of the design, not after the source project (for example ink and paper → `inkpaper`).

## 1. Classify
Take the source's shared UI code (component folders, motion, theme, gallery page, global CSS, fonts, the screen design guide) and sort every file into four classes by looking at its imports.

```bash
for f in src/components/*.ts* src/components/motion/*; do echo "$f :: $(grep -oE 'from "[^"]+"' $f | tr '\n' ' ')"; done
```

| Class | Criterion | Handling |
| --- | --- | --- |
| A. As-is | Imports no business module (`@/modules/...` and the like) | Copy |
| B. After wiring | Imports only values that differ per app, such as the menu list, product name, API URLs or business types | Copy, then move those values to `lib/ui-pack-config.ts`. For business types, define only the fields that are needed in `lib/*-types.ts` |
| C. Reference pattern | Shows the design identity but is tied to business data (a timeline, a business-specific band, and so on) | Copy into `patterns/` only. The target project builds its own after this model |
| D. Excluded | Business-only | Leave out |

Show the classification table to the user and get confirmation before extracting.

## 2. Extract
1. Folders: `guide/ tokens/ fonts/ lib/ components/ patterns/ gallery/ tests/`
2. Copy the A, B and C files, the global CSS (`tokens/globals.css`), the layout (`tokens/layout.example.tsx`), the gallery page (`gallery/page.example.tsx`), the design guide (`guide/`) and the related tests.
3. Wiring for B: fix imports until `grep -rn 'from "@/' <pack>` shows no import outside `@/lib/<pack file>` and `@/components/...`. Also move source-specific strings such as storage keys and the product name (`grep -rn <source name>`) into the configuration.
4. Add a "pack note" block at the top of the design guide: which sections to keep as they are, which sections to adapt to the target, and which content is product-specific and must be removed.
5. Write `pack.json`. Follow the format in `~/.claude/skills/ui-pack/references/pack-format.md` (the `pack.json` of an existing pack in the pack store is the best worked example when there is one): `name, version, description, source{repo, commit}, requires, dependencies, devDependencies, install[{from,to,mode}], config, patterns, optional, sources, packOnly, viewer`. `viewer` is the pack viewer configuration: `gallery` (the gallery component, `module#exported name`, required), `themeSwitch` (the theme switch component, omit when there is none), `guide` (path of the design guide), `background` (background color of the table-of-contents bar, for example `var(--paper)`). `sources` is the mapping that `source-changes.py` uses to find source changes.
6. In `components` of `pack.json`, record a status for every component defined in the `ui-pack` skill's `~/.claude/skills/ui-pack/catalog.json`: `present` (files in `files`, gallery card title in `gallery`), `rules-only`, `absent`, `unused` (reason in `note`). Record every component of the catalog, with none missing. If the pack has a component that the catalog does not, add its definition to `catalog.json` first. When you add a definition, also record that component as `absent` in the `pack.json` of the existing packs and rebuild the pack viewers of those packs with `build-view.py` (the component catalog is embedded in the pack viewer).
7. Write the gallery copy (`components/design/Gallery.tsx`) with generic sample words that are not tied to any business, instead of the source's business vocabulary (consuming projects do not edit the gallery). Write it in the language of the apps the pack is for.
8. Describe the contents of each folder in `README.md`.

## 3. Verify
0. The design quality review is done only at this stage, when the pack is made. Review the source gallery (`/design` and the like) and the design guide against the criteria of an anti-slop design review skill (for example `unslop`, when one is installed). Fix what needs fixing in the source project, then bring it into the pack. Do not repeat this review when the pack is applied to a consuming project.
1. Create an empty Next.js project in the scratchpad (`pnpm dlx create-next-app@<same version as the source> <name> --ts --tailwind --app --src-dir --use-pnpm --import-alias "@/*" --yes`) and install with `python3 ~/.claude/skills/ui-pack/scripts/install.py <pack> <empty project> --name <name>`. `create-next-app` creates the project under the current folder, so `cd` into the scratchpad working folder first and then run it (`pnpm --dir` does not change where the project is created, so the folder would appear in the repository you are working in).
2. `tsc --noEmit`, lint and `vitest run` must pass.
3. Capture the `/design` gallery in the light and dark theme and check with your own eyes that it looks the same as the source gallery.
4. `python3 ~/.claude/skills/ui-pack-create/scripts/source-changes.py <pack>` must print "No pack file has changed in the source."
5. Build the pack viewer (`<pack>/view/index.html`) and the pack index (`packs/index.html`) with `python3 ~/.claude/skills/ui-pack/scripts/build-view.py <pack>`. Copy only the pack viewer's `index.html` into an empty folder, open it with a file URL, capture the light and dark theme and check that the gallery components are rendered. Also check that the gallery buttons and the theme switch work (that the page is hydrated).

## 4. Record
If the pack store is a git repository, commit the pack and the pack viewer on the worktree branch of the pack store and ask the user when to merge. If it is not, the pack is already in place; say so in the report.
