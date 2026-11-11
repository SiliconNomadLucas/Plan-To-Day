# Community scan baseline

Release `0.1.2` reported 0 errors, 287 warnings, and 23 other recommendations.
The phase 1-3 focus from that report is:

| Category | Reported findings |
| --- | ---: |
| Promise returned to a void callback | 85 |
| Floating promises | 19 |
| Unsafe member access | 42 |
| Unsafe assignments | 12 |
| Unsafe arguments | 7 |
| Empty blocks | 4 |

The local ESLint baseline for these same categories was 127 findings:
78 void-callback Promises, 12 floating Promises, 20 unsafe member accesses,
7 unsafe assignments, 6 unsafe arguments, and 4 empty blocks. The scanner
and local ESLint count differently.

The phase 1-3 findings are now zero locally. `npm run lint:submission` gates
all six categories as errors alongside the unsupported-API and direct-style
rules. The community scanner also reports CSS, compatibility, and cleanup
warnings outside this phase; do not treat a lower total count as proof of
correct behavior.

## Phase 4-6 local verification (0.1.3 working tree)

- `npm run lint:submission` now also rejects redundant type assertions, unused
  bindings, and uses of `document.createElement` that should use Obsidian's
  element helpers. Bare animation/timer calls were moved to `window.*`, and the
  build uses Node's `builtinModules` instead of `builtin-modules`.
- The English README is the primary project description; the existing Chinese
  guide is preserved in `README.zh-CN.md`.
- `styles.css` parses with esbuild and contains no `!important`, `all: unset`,
  or custom WebKit scrollbar declarations. Mobile stat-card overrides were
  consolidated. This is a source check, not a substitute for theme/device QA.
- `npm run release:check` passes (101 tests) and release metadata is consistent
  at 0.1.3. The local vault plugin copy was SHA-256-verified; `data.json` was
  not modified. No tag or public release has been created.

The settings tab deliberately retains `display()` for the declared Obsidian
minimum of 1.7.2. The declarative `getSettingDefinitions()` API starts in
1.13.0; replacing the existing tab outright would drop older-version support.
The scanner's settings-search/deprecation recommendation remains open until
an explicit compatibility design and test matrix are implemented.

Desktop visual smoke testing could not be completed because the running
Obsidian window was minimized and the UI capture could not bind to it. Mobile
light/dark theme and touch-interaction testing still requires a real device.
Run those checks before publishing the new tag.
