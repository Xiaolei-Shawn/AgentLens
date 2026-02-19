# Repo Sync Guide

This repository (`AL`) is the public source of truth.

## Roles

- Public OSS repo: `/Users/xiaoleishawn/private/AL`
- Private mirror repo: `/Users/xiaoleishawn/private/AgentLens`

## Configured remotes

- `private` -> `/Users/xiaoleishawn/private/AgentLens`

Set your public GitHub remote as `origin` when ready:

```bash
git remote add origin <PUBLIC_GITHUB_URL>
```

## Daily workflow

1. Do work in this repo.
2. Commit in small units.
3. Sync committed changes to private repo:

```bash
cd /Users/xiaoleishawn/private/AgentLens
git fetch public
git cherry-pick <sha_from_AL>
```

## Pull fixes back from private

Only for commits intended for public release:

```bash
cd /Users/xiaoleishawn/private/AL
git fetch private
git cherry-pick <safe_sha_from_AgentLens>
```

## Release order

1. Publish `schema`
2. Publish `mcp-server`
3. Publish/deploy `webapp` build (`build`)
