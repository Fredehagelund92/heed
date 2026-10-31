# Releasing Heed

How a version of Heed is made: one version number, a release pull request that writes the
changelog, and a tag that builds the images and the GitHub Release. Only a maintainer merges the
release pull request and pushes the tag; nothing is released by a merge alone.

## One version number

Heed's version is written in one place, `version` in `package.json`. The service reads it from
there when it starts (`src/server/version.ts`) and names it in:

- the MCP server info an agent gets when it connects (`serverInfo.version`);
- the OpenAPI document, `info.version`, as served at `/api/v1/openapi.json` and as written in
  `docs/api/openapi.json`;
- `GET /health` and `GET /health/ready` (`"version": "0.1.0"`).

`tests/server/version.test.ts` and the MCP conformance test fail when any of them, the lockfile or
`.release-please-manifest.json` names another version. Nobody changes the number by hand: the
release pull request does.

Before 1.0, Heed is for trying it on one computer, not for production use, and every release says
so in its notes.

## How a release happens

1. **Every merge to `main`** runs [release-please](https://github.com/googleapis/release-please)
   (`.github/workflows/release-please.yml`, set up in `release-please-config.json`). It keeps one
   pull request open, titled `chore(main): release 0.1.0` with the next version, that:
   - writes the new section of `CHANGELOG.md` from the commit titles since the last release;
   - raises the version in `package.json`, `package-lock.json`, `.release-please-manifest.json`,
     `docs/api/openapi.json` and the supported versions in `SECURITY.md`.

   It makes the pull request again on top of `main` after every merge, even one that adds no line
   to the changelog, so the pull request is never behind `main`.

   CI runs on the release pull request as on any other and reports **CI gate**. The pull request
   is opened by the `github-actions` bot, so GitHub holds its CI run until a maintainer approves
   it: on the pull request, choose **Approve workflows to run**. Approve the run of the newest
   push, when you mean to release; the pull request is made again after every merge.

2. **A maintainer merges the release pull request** once **CI gate** has passed, with a squash
   merge like any other.
3. **A maintainer tags the commit that merge made**, `v0.1.0`, and pushes the tag.
4. **The tag runs `.github/workflows/release.yml`**:
   1. it checks that the tag names the version in `package.json`, that the tagged commit is the
      one that merged the release pull request into `main`, and that **CI gate** passed on it;
   2. it builds both images in the `Dockerfile`, the service and the web app, for `linux/amd64` and
      `linux/arm64`, each on a runner of that platform;
   3. it pushes them to the GitHub Container Registry with an SBOM and the build provenance, as
      `ghcr.io/fredehagelund92/heed` (the service) and `ghcr.io/fredehagelund92/heed-web` (the web
      app), each tagged `0.1.0`, `0.1` and `latest`;
   4. it signs the build provenance of both images with GitHub's artifact attestations, and checks
      that each platform has its SBOM and provenance and that the signature verifies;
   5. it creates the GitHub Release `Heed 0.1.0`: its notes are the version's section of
      `CHANGELOG.md` (`scripts/release-notes.ts`) and the two images with their digests;
   6. it moves the release pull request's label from `autorelease: pending` to
      `autorelease: tagged`. release-please opens no new release pull request while a merged one
      is still pending.

The workflows use only the workflow's own token, with the least each job needs. No secret is
stored.

## The version number and the changelog

The pull request title becomes the commit on `main` (one squash commit per pull request), and the
commit title becomes the changelog line, so a title is written for the person who reads the
release notes. The type decides where it goes and what it raises:

| Title                        | In the changelog | Raises, before 1.0 | Raises, from 1.0 |
| ---------------------------- | ---------------- | ------------------ | ---------------- |
| `feat: ...`                  | Features         | 0.1.0 to 0.2.0     | 1.0.0 to 1.1.0   |
| `fix: ...`                   | Fixes            | 0.1.0 to 0.1.1     | 1.0.0 to 1.0.1   |
| `perf: ...`                  | Faster           | 0.1.0 to 0.1.1     | 1.0.0 to 1.0.1   |
| `feat!: ...` (breaks a user) | Features         | 0.1.0 to 0.2.0     | 1.0.0 to 2.0.0   |
| `docs`, `ci`, `test`, ...    | left out         | nothing            | nothing          |

`CHANGELOG.md` is written by release-please and by nothing else. Never edit it, in the release
pull request or later. To change what a line says, edit the description of the pull request that
merged the change, before the release pull request is merged, and add the words release-please
should use instead:

```text
BEGIN_COMMIT_OVERRIDE
fix(web): say a question was not looked up instead of Not found
END_COMMIT_OVERRIDE
```

To choose the next number yourself, end the message of the squash commit with the line
`Release-As: 0.2.0` when you merge a pull request.

**What's new** in the app (`docs/help/changelog.md`) is a different page: a few changes people
notice, in the app's words, written by hand ([the help pages](help/README.md#whats-new)). Check
that it is current before you merge a release pull request.

## Set up once, before the first release

These are repository settings, so a maintainer makes them:

1. **Settings, Actions, General, Workflow permissions:** turn on **Allow GitHub Actions to create
   and approve pull requests**. Leave the default permissions at read. Without it the release
   pull request workflow fails on every merge to `main` with "GitHub Actions is not permitted to
   create or approve pull requests".
2. **After the first release**, the two packages on ghcr.io are private, as every new package is.
   On each package's page (**Packages**, `heed` and `heed-web`, **Package settings**), choose
   **Change visibility**, then **Public**, so `docker pull` works without signing in. Check that
   each shows this repository under **Repository source**.
3. Optional: a tag ruleset (**Settings, Rules, Rulesets, New tag ruleset**, for `v*`) that lets only
   maintainers create, move or delete release tags.

## The first release, 0.1.0

1. Make the setting in step 1 above. If the change that added these workflows merged before it,
   start the release pull request by hand: **Actions, Release pull request, Run workflow** on
   `main`, or

   ```sh
   gh workflow run release-please.yml --repo Fredehagelund92/heed --ref main
   ```

2. Open the pull request `chore(main): release 0.1.0`. Read the new `CHANGELOG.md` and check that
   `package.json`, `package-lock.json`, `.release-please-manifest.json`, `docs/api/openapi.json`
   and `SECURITY.md` say `0.1.0`. Check **What's new**. Choose **Approve workflows to run**, and
   wait for **CI gate**.
3. Merge it. Wait for **CI gate** to pass on the commit the merge made on `main`.
4. Tag that commit and push the tag:

   ```sh
   git fetch origin
   sha=$(gh pr view <release pull request number> --repo Fredehagelund92/heed --json mergeCommit --jq .mergeCommit.oid)
   git tag -a v0.1.0 -m "Heed 0.1.0" "$sha"
   git push origin v0.1.0
   ```

5. Watch **Actions, Release**. It takes a few minutes. When it passes, the release is at
   `https://github.com/Fredehagelund92/heed/releases/tag/v0.1.0`.
6. Make both packages public (step 2 above).
7. Check the images:

   ```sh
   docker buildx imagetools inspect ghcr.io/fredehagelund92/heed:0.1.0     # linux/amd64 and linux/arm64
   gh attestation verify oci://ghcr.io/fredehagelund92/heed:0.1.0 --repo Fredehagelund92/heed
   gh attestation verify oci://ghcr.io/fredehagelund92/heed-web:0.1.0 --repo Fredehagelund92/heed
   ```

Later releases are steps 2 to 5 and 7.

## When something goes wrong

- **The tag does not name the version, or names another commit:** the first job stops before
  anything is built. Delete the tag (`git push origin :refs/tags/v0.1.0`, then
  `git tag -d v0.1.0`) and tag the commit that merged the release pull request.
- **CI gate has not passed on the tagged commit yet:** the first job stops. Once it has passed,
  open the run and choose **Re-run all jobs**.
- **A build or the release failed half way:** choose **Re-run failed jobs**. Images are pushed by
  digest, and a release that was already made gets its notes written again.
- **To take a release back:** delete the GitHub Release and the tag. Pushed images stay where they
  are, under their digests; delete the versions on each package's page if they must go. To make
  the same release again, push the same tag again.
