#!/usr/bin/env bash
# Which CI jobs a change needs (docs/development.md, "Validation tiers"). Reads the changed paths
# on stdin, one per line, and prints the job switches as key=value lines for $GITHUB_OUTPUT.
# FULL=true (a push to main, the nightly run, a manual run or the full-ci label) runs everything.
#
#   sensitive  db, the service, sign-in, MCP, security files, workflows, packages: everything runs
#   docs       prose nothing in the app reads, and the docs site (apps/docs): only the checks (type
#              check, lint, unit tests, build), which build the site and check its links
#   code       anything else: every job that runs the code
#
# A path that matches no rule counts as code, and an empty list runs everything, so a mistake here
# runs more, never less.
set -euo pipefail

full=${FULL:-false}
sensitive=false
docs=false
code=false
seen=false

while IFS= read -r path; do
  [ -n "$path" ] || continue
  seen=true
  case "$path" in
    db/* | src/server/* | *auth* | *sign-in* | *mcp* | *security* | *SECURITY* | \
      .gitleaks.toml | osv-scanner.toml | .github/* | package*.json | */package*.json | \
      .nvmrc | .npmrc | Dockerfile | docker/* | compose.yaml)
      sensitive=true ;;
    apps/docs/*)
      docs=true ;;
    # The help pages, the templates and the API description are read by the app and its tests.
    docs/help/* | docs/templates/* | docs/api/*)
      code=true ;;
    src/* | tests/* | scripts/* | apps/*)
      code=true ;;
    docs/* | *.md | LICENSE)
      docs=true ;;
    *)
      code=true ;;
  esac
done

if [ "$sensitive" = true ] || [ "$seen" = false ]; then
  full=true
fi

run_code=false
if [ "$full" = true ] || [ "$code" = true ]; then
  run_code=true
fi

check=false
if [ "$run_code" = true ] || [ "$docs" = true ]; then
  check=true
fi

echo "full=$full"
echo "check=$check"
echo "code=$run_code"
