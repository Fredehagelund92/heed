#!/usr/bin/env bash
# Adds one built version of the docs site to the gh-pages branch, which collects them all
# (apps/docs/README.md). Run from a checkout of the repository with a push credential.
#
#   publish-docs.sh <the built site> <vMAJOR.MINOR or next>
#
# Each attempt starts from the branch as it is now, so a release and /next/ can publish at the same
# time: the one that loses the push builds on the other's commit. They touch different folders.
set -euo pipefail

built=$(cd "$1" && pwd)
folder=$2
remote=${DOCS_REMOTE:-origin}
pages="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/gh-pages"
collect="$(pwd)/apps/docs/scripts/collect.ts"

for attempt in 1 2 3 4 5; do
  rm -rf "$pages"
  git worktree prune
  if git ls-remote --exit-code --heads "$remote" gh-pages > /dev/null; then
    git fetch --depth=1 "$remote" +refs/heads/gh-pages:refs/remotes/"$remote"/gh-pages
    git worktree add --detach "$pages" "refs/remotes/$remote/gh-pages"
  else
    git worktree add --orphan -b "gh-pages-$attempt" "$pages"
  fi

  node "$collect" "$pages" "$built" "$folder"
  git -C "$pages" add --all
  if git -C "$pages" diff --cached --quiet; then
    echo "gh-pages already holds this build of $folder."
    exit 0
  fi
  git -C "$pages" commit --quiet --message "docs: publish $folder from ${GITHUB_SHA:-$(git rev-parse HEAD)}"
  if git -C "$pages" push "$remote" HEAD:refs/heads/gh-pages; then
    echo "Published $folder to gh-pages."
    exit 0
  fi
  echo "Another publish got there first (attempt $attempt): starting again from the branch."
  sleep "$attempt"
done

echo "::error::Could not publish $folder to gh-pages after 5 attempts."
exit 1
