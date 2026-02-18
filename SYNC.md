# Repo Sync Guide (Public OSS)

This repository (`AL`) is the public OSS source of truth.

## Roles

- Public OSS repo: `/Users/xiaoleishawn/private/AL`
- Private Pro repo: `/Users/xiaoleishawn/private/AgentLens`

## Configured remotes

- `private` -> `/Users/xiaoleishawn/private/AgentLens`

Set your public GitHub remote as `origin` when ready:

```bash
git remote add origin <PUBLIC_GITHUB_URL>
```

## Daily workflow

1. Do OSS-safe work in this repo.
2. Commit in small units.
3. Sync committed OSS changes to private repo:

```bash
cd /Users/xiaoleishawn/private/AgentLens
git fetch public
git cherry-pick <sha_from_AL>
```

## Pull safe fixes back from private

Only for commits without proprietary files/logic:

```bash
cd /Users/xiaoleishawn/private/AL
git fetch private
git cherry-pick <safe_sha_from_AgentLens>
```

## Never publish from private-only areas

Do not include these in OSS commits/releases:

- `webapp/src/pro/**`
- private heuristics/weights/prompts/data
- private deployment/config secrets

## Release order (OSS)

1. Publish `schema`
2. Publish `mcp-server`
3. Publish/deploy OSS `webapp` build (`build:oss`)
