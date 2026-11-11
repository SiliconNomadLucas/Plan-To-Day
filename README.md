# Plan to Day

Plan to Day is a local-first task and goal planner for Obsidian. Break long-term goals into yearly, quarterly, monthly, and weekly plans, then turn weekly goals into tasks for My Day. The plugin also provides lists, schedules, recurring tasks, a four-quadrant view, reviews, and a recycle bin.

[简体中文说明](README.zh-CN.md)

## Features

- Create, edit, complete, move, restore, and organize tasks in custom lists. Add notes, tags, priorities, subtasks, reminders, due dates, and recurring schedules.
- Plan life goals and yearly, quarterly, monthly, and weekly goals with parent-child relationships and lifecycle states (active, shelved, and abandoned).
- Use My Day, calendar and timeline schedules, the importance/urgency quadrants, and daily, weekly, monthly, or yearly review statistics.
- Get task suggestions in **My Day** from local rules, including regular daily tasks based on this week's goals. Suggestions are previews until you add them; they do not use a remote AI service. Monthly plans do not generate weekly-plan suggestions.
- Use the onboarding guide and desktop or mobile layouts, including a mobile sidebar for task and goal details.

## Privacy and data

Tasks, lists, tags, groups, and backups stay in your vault, by default under `todo/`. The plugin does not require an account, API key, or network connection for recommendations. Database migrations run on load; a database written by a newer plugin version is not downgraded or overwritten. Backups are retained for up to 30 days.

## Install

Install **Plan to Day** from Obsidian's Community plugins directory when it is available, or install it manually:

1. Download `main.js`, `manifest.json`, and `styles.css` from a GitHub Release whose tag exactly matches the version in `manifest.json` (without a `v` prefix).
2. Place the three files in your vault's `.obsidian/plugins/plan-to-day/` folder.
3. Enable **Plan to Day** in Community plugins.

If you previously installed the plugin as `obsidian-todo`, disable the old plugin before enabling Plan to Day. On first launch, the new plugin copies the old plugin's settings only if it has no settings of its own. It does not delete the old plugin's files. Check your tasks and settings before removing the old plugin directory.

## Compatibility

- Minimum Obsidian version: **1.7.2**.
- Desktop and mobile; English and Chinese interfaces; light and dark themes.
- Some complex mobile interactions still require testing on a physical device. There is no automated end-to-end UI test suite yet.

## Build and test

```bash
npm install
npm run release:check
```

`npm run release:check` runs TypeScript compilation and the production build, tests, submission lint, and release metadata validation. The build creates `main.js` in the repository root. Use `npm run dev` for a watch build.

Source layout: `src/models/` for data models, `src/services/` for persistence and domain operations, `src/views/` for views, `src/ui/` for dialogs, and `src/utils/` for utilities.

## Release process

1. Run `npm run version -- <next-version>` with a version higher than the current one.
2. Run `npm run release:check`, commit the changes, and push a tag that exactly matches the manifest version, without `v`.
3. After CI passes, the release workflow creates a GitHub Release containing `main.js`, `manifest.json`, and `styles.css`.

Do not retag or replace an existing public release to publish new code.

## License

[MIT](LICENSE). Maintained by [SiliconNomadLucas](https://github.com/SiliconNomadLucas). [Source repository](https://github.com/SiliconNomadLucas/Obsidian-Todo).
