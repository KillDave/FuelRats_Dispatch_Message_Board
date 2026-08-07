# Branches and releases

`main` is what people are running. `dev` is what is being written.

That distinction is worth keeping because the board updates itself: from v2.0, every install polls
`releases/latest` every thirty minutes and offers a one-click update. Whatever is released reaches
everybody within the hour, so it is worth being able to say exactly what that is.

## Working

Commit to `dev` and push whenever. Nothing there reaches anybody.

```bash
git switch dev
git push
```

When it is ready to ship, open a pull request from `dev` into `main`. That is also the review point —
before write access existed the fork provided one, and this replaces it.

```bash
gh pr create --base main --head dev
```

## Releasing

Only ever tag `main`.

```bash
git switch main && git pull
npm run build:release
gh release create v2.0.3 --target main release/*
```

A release is attached to a tag, not to a branch, and the Releases page is repo-wide — so a release
cut from `dev` is offered to every install exactly as a real one would be. There is no branch check
anywhere in the updater to save you.

### Test builds

Mark them as prereleases. GitHub's `releases/latest` means *most recent non-draft, non-prerelease*,
which is the endpoint both the board and the installer ask, so a prerelease is visible to anyone who
wants it and invisible to everybody else.

```bash
gh release create v2.0.3-rc1 --target dev --prerelease release/*
```

Use `--draft` when you want to check the artefacts before anyone can see them at all.

## Hotfixes

Branch from `main`, not from `dev`, so the fix ships without whatever `dev` is halfway through. Then
merge it back so `dev` does not lose it.

```bash
git switch -c hotfix/thing main
# fix, PR into main, release
git switch dev && git merge main
```

## Where the update check points

Neither repository name is written down anywhere in the source. `scripts/repo.mjs` resolves it at
build time from the `origin` remote of the checkout being built, falling back to `package.json`'s
`repository` field — so a build made from this repository checks this repository's releases, and a
build made from a fork checks the fork's. `FRBOARD_REPO` overrides both.

That matters when moving the release channel between repositories: existing installs keep asking
wherever *their* copy was built from, so the move needs one release published in the old place,
built with `FRBOARD_REPO` pointing at the new one, to carry people across.
