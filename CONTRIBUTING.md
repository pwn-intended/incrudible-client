# Contributing

## Development flow

`main` is the release branch. Changes reach it through short-lived branches and
pull requests:

```sh
git switch main
git pull --ff-only
git switch -c fix/descriptive-name
```

Make focused changes, rebuild the tracked distribution bundle when source code
changes, then commit and push the branch:

```sh
npm run build
git add src tests dist
git commit -m "fix: describe the behavior change"
git push -u origin HEAD
```

Open a pull request into `main`. CI builds the production bundle, runs the
Playwright suite in Chromium, Firefox, and WebKit, and rejects a stale committed
bundle. Once the required check passes, review the diff yourself and squash
merge; approval from another account is not required.

## Commit and PR titles

Use Conventional Commits for the squash-merged PR title:

- `fix:` creates a patch release.
- `feat:` creates a minor release.
- `feat!:` or a `BREAKING CHANGE:` footer creates a major release.
- `docs:`, `test:`, `refactor:`, and `chore:` do not trigger a version bump by
  themselves.

Keep implementation commits readable, but the PR title is the release contract
because pull requests are squash merged.

## Releases

Release Please watches `main` and maintains a release pull request containing
the next package version and changelog. Merge that PR when the accumulated
changes are ready to publish. The merge creates the GitHub release and immutable
version tag, such as `v1.1.0`. This pull request is a release batching
mechanism, not a request for peer approval.

Do not manually edit package versions, changelogs, or tags during the normal
release flow. Consumers should use an exact jsDelivr tag rather than `@main`:

```text
https://cdn.jsdelivr.net/gh/pwn-intended/incrudible-client@v1.1.0/dist/incrudible-client.min.js
```

An urgent fix follows the same process on a `hotfix/` branch. Keeping the PR
small and merging it promptly after CI passes is faster and safer than bypassing
CI.

Repository maintainers should apply the branch rules and merge behavior in
[docs/repository-settings.md](docs/repository-settings.md).
