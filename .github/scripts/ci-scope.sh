#!/usr/bin/env bash
# Which CI jobs a change needs (docs/development.md, "Validation tiers"). Reads the changed paths
# on stdin, one per line, and prints the job switches as key=value lines for $GITHUB_OUTPUT.
# FULL=true (a push to main, the nightly run, a manual run or the full-ci label) runs everything.
#
#   sensitive  db, the service, sign-in, MCP, security files, workflows, packages: everything runs
#   mockup     apps/mockup: only the mockup job
#   docs       prose nothing in the app reads: only the checks (type check, lint, unit tests, build)
#   code       anything else: every app job
#
# A path that matches no rule counts as code, and an empty list runs everything, so a mistake here
# runs more, never less.
set -euo pipefail

full=${FULL:-false}
sensitive=false
mockup=false
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
    apps/mockup/*)
      mockup=true ;;
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

app=false
if [ "$full" = true ] || [ "$code" = true ]; then
  app=true
fi

check=false
if [ "$app" = true ] || [ "$docs" = true ]; then
  check=true
fi

# The mockup job needs apps/mockup in the checkout; MOCKUP_PRESENT says whether it is there.
run_mockup=false
if [ "${MOCKUP_PRESENT:-false}" = true ] && { [ "$full" = true ] || [ "$mockup" = true ]; }; then
  run_mockup=true
fi

echo "full=$full"
echo "check=$check"
echo "app=$app"
echo "mockup=$run_mockup"
