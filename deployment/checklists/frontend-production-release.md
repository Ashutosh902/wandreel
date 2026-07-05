# Frontend Production Release Checklist

This checklist exists to avoid a common Wandreel deployment confusion:

- `app.wandreel.com` does not automatically map to a Git branch
- the Android Capacitor wrapper loads `https://app.wandreel.com`
- local `npm run build` and `npx cap copy android` do not change production by themselves

Use this checklist any time a frontend change must be visible on:

- `https://app.wandreel.com`
- the Android wrapper
- the installed PWA

## Core Rule

Production reflects the most recent successful frontend deploy done with:

```bash
npm run deploy
```

If a change is not deployed to production, it will not appear on:

- `app.wandreel.com`
- Android wrapper builds that use `server.url = https://app.wandreel.com`

## Before Deploy

- [ ] Confirm the current branch is the intended release branch.
- [ ] Run `git branch --show-current`.
- [ ] Run `git status --short` and confirm the working tree contains exactly the intended changes.
- [ ] Run `npm run build`.
- [ ] Run Hero Card or feature-specific tests if relevant.
- [ ] Confirm whether the Android wrapper is expected to reflect this release.

## Deploy

- [ ] From the repo root, run:

```bash
npm run deploy
```

- [ ] Wait for Wrangler to print a successful deployment result.
- [ ] Record the returned production version ID.
- [ ] Record the deploy time and operator.

## Immediate Verification

- [ ] Open `https://app.wandreel.com`.
- [ ] Hard refresh once.
- [ ] Confirm the expected UI change is visible.
- [ ] Confirm the expected API-backed behavior is visible.
- [ ] If the change depends on authentication, verify it with a real logged-in account.

## Android Wrapper Verification

Important:

- the Android wrapper uses production URL mode
- it loads `https://app.wandreel.com`
- it does not use the local `dist/` bundle unless the wrapper config is changed

Checklist:

- [ ] Re-run the Android app from Android Studio after production deploy.
- [ ] If the old UI still appears, uninstall the app from the device/emulator once.
- [ ] Reinstall and reopen the app.
- [ ] Confirm the production change is now visible inside Android.

## If You Only Ran Local Build Commands

These commands do not deploy to production:

```bash
npm run build
npx cap copy android
npx cap sync android
```

What they do:

- `npm run build`: creates a local production web bundle
- `npx cap copy android`: copies local web assets into the Android project
- `npx cap sync android`: syncs Capacitor project files

What they do not do:

- update `app.wandreel.com`
- update the Android wrapper if it is configured to load production URL mode

## How To Tell What Production Is Showing

Production currently reflects:

- the latest successful Wrangler deploy
- not a reliably traceable Git branch by default

Use:

```bash
npx wrangler deployments list
```

Current limitation:

- deployment metadata may show `Source: Unknown (deployment)`
- branch name and commit identity may not be preserved automatically

## Recommended Release Logging

For every production frontend release, record:

- branch name
- short commit SHA
- deploy timestamp
- Wrangler version ID
- operator
- user-facing feature changed

Suggested release note format:

```text
Frontend prod deploy
Branch: <branch-name>
Commit: <short-sha>
Time: <utc timestamp>
Version ID: <wrangler-version-id>
Change: <feature summary>
```

## Hero Card Specific Verification

If the release includes Hero Card work:

- [ ] Home screen shows the expected Hero Card instead of the generic fallback when real user data exists.
- [ ] CTA does the expected action.
- [ ] `Save idea` appears on the card.
- [ ] `Save idea` shows `Idea saved for later.` on first tap.
- [ ] `Save idea` shows `Idea already saved.` on repeat tap for the same card.
- [ ] Freshness and alternatives still work after reloads.

## Future Improvement

The current production workflow would be easier to audit if Wandreel later adds:

- deploy tags containing branch and commit
- a visible build stamp in app settings or debug UI
- a preview/staging URL for branch validation before production
