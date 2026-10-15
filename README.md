# incrudible-client

Shared client-side JS framework for InCRUDibly-based Apps Script apps,
built via `esbuild` and served via jsDelivr's GitHub CDN mode. Production
consumers should pin an immutable release tag:

```text
https://cdn.jsdelivr.net/gh/pwn-intended/incrudible-client@v1.1.0/dist/incrudible-client.min.js
```

`APP.imageToUpload(file)` reads a browser `File` and resolves to
`{ name, mimeType, base64 }`, ready to combine with a Drive `folderId` for
`InCRUDibly.uploadImage`. It rejects non-image files and images larger than
10 MiB before starting `FileReader`.

`DAYS.daysElapsed(start, end, options)` counts signed whole days between two
strict `YYYY-MM-DD` dates. With `businessDays: true`, it excludes the start
date, includes the end date, skips weekends, and calls the optional
`isHoliday(isoDate)` predicate for caller-owned closure calendars.

```js
import { DAYS } from "incrudible-client";

const elapsed = DAYS.daysElapsed("2026-07-17", "2026-07-20", {
  businessDays: true,
  isHoliday: isoDate => bankClosures.has(isoDate),
});
// 1
```

## Architecture

`APP` remains the public compatibility facade. Its workflow, rule, UI,
feedback, and modal state is owned by pure reducers in `src/state.js`; existing
assignments such as `APP.workflow = value` and `APP.rules.modalRules = rules`
dispatch actions behind that facade.

Store subscriptions apply state to browser effects such as the loading overlay,
theme persistence, and selected tabs. Form values, rule evaluation, rendering,
clipboard and server calls, and transient interactions such as drawers and
dragging stay outside the store so DOM state is not duplicated.

## Testing

Install dependencies and the browser engines once:

```sh
npm install
npx playwright install chromium firefox webkit
```

`npm test` rebuilds the production bundle, then tests that artifact in Chromium,
Firefox, and WebKit. Use `npm run test:headed -- --project=chromium` to inspect
the browser interactions locally. GitHub Actions runs the same suite for every
pull request and update to `main`, and rejects stale committed distribution
bundles.

## Development and releases

Changes are developed on short-lived branches and squash merged through pull
requests after CI passes. Conventional Commit PR titles drive Release Please,
which maintains the version/changelog release PR and creates immutable GitHub
release tags when that PR is merged. See [CONTRIBUTING.md](CONTRIBUTING.md) for
the complete workflow and [docs/repository-settings.md](docs/repository-settings.md)
for the GitHub rules that enforce it.

## Docs

- [Form Control Reference](docs/form-controls.md) - every control type this
  library renders, each as a complete, standalone config example.
