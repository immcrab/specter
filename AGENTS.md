# AGENTS.md

## Version bump is required

`version.json` is the single source of truth for the site version. The fixed badge in the top-right corner of `index.html` (`#siteVersion`) reads it, and `index.html` carries the same value as a no-JS fallback.

Before committing any change to the site's HTML, CSS, JavaScript, data, or assets, bump the version:

```sh
node scripts/bump-version.mjs          # patch (default): 1.0.0 -> 1.0.1
node scripts/bump-version.mjs minor    # 1.0.1 -> 1.1.0
node scripts/bump-version.mjs major    # 1.1.0 -> 2.0.0
node scripts/bump-version.mjs 2.4.0    # exact version
```

Commit `version.json` and `index.html` together with the change. Never edit only one of them by hand; the script keeps both in sync. A code change without a version bump is incomplete.

## Single-file build

`specter.html` is generated: `index.html` plus every stylesheet, script, game catalogue, legal page and image it needs, inlined into one downloadable document. Regenerate it whenever the page, its CSS, JS, data or assets change:

```sh
node scripts/build-single-file.mjs
```

Commit `specter.html` with the change so the download link in the "Make your own Aether" panel keeps working.
