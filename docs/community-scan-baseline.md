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
- At that stage, `npm run release:check` passed (101 tests) and release
  metadata was consistent at 0.1.3. The local vault plugin copy was
  SHA-256-verified; `data.json` was not modified.

The settings tab originally retained `display()` for the declared Obsidian
minimum of 1.7.2. The declarative `getSettingDefinitions()` API starts in
1.13.0; replacing the existing tab outright would drop older-version support.

Desktop visual smoke testing could not be completed because the running
Obsidian window was minimized and the UI capture could not bind to it. Mobile
light/dark theme and touch-interaction testing still requires a real device.
Run those checks before publishing the new tag.

## Settings API follow-up after the 0.1.3 scan

- `getSettingDefinitions()` now indexes the actual settings, including the
  custom birthday, tag, onboarding, and data-management rows. On 1.13+,
  `update()` refreshes the definitions after language, tag, or data changes.
  The imperative `display()` remains a guarded fallback for 1.7.2-1.12.x.
- Destructive actions use `setDestructive()` when available and fall back to
  `setWarning()` on older hosts; their confirmation dialogs remain in place.
  Static scans may still report the single fallback calls as deprecated.
- New installs default to ERROR logging; INFO is emitted through the debug
  console channel when the INFO setting is active. Existing saved log levels
  are preserved rather than silently overwritten.
- Local checks pass with 108 tests and the existing unsupported-API lint gate
  in the 0.1.4 working tree.
  Tests cover declarative definitions, control persistence, guarded fallback,
  button styling, and default logging. A scanner re-run and real-device
  testing have not yet been performed for this follow-up.

Before publishing the next version, open the settings tab and search on both
an older supported Obsidian release and 1.13+, verify language changes and
tag editing, and confirm that clearing/resetting data still requires explicit
confirmation. The local Obsidian window was minimized during this pass, so
desktop visual smoke testing remains outstanding.
