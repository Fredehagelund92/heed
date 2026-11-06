#!/usr/bin/env bash
# Run from the repository, with `docker compose up` already running the demo: a connector's secret
# is saved through the web container's address and is still there when the service's container is
# made again, and both compose forms name the same store. The file's address is never fetched: a
# source is read by the jobs later, and this checks only that the secret is kept.
set -euo pipefail

web=http://127.0.0.1:${HEED_WEB_PORT:-8080}
fail() {
  echo "not ok - $1" >&2
  exit 1
}

for form in '-f compose.yaml' '-f compose.yaml -f compose.images.yaml'; do
  # shellcheck disable=SC2086 # the form is several arguments
  docker compose $form config | grep -q 'HEED_SECRETS_DIR: /var/lib/heed/secrets' ||
    fail "docker compose $form names the secret store"
done
docker compose logs heed | grep -q '"secretStore":"local"' || fail 'the service opened the store'
[ "$(docker compose exec -T heed stat -c %a /var/lib/heed/secrets)" = 700 ] ||
  fail 'only the service may open the store'

cookies=$(mktemp)
trap 'rm -f "$cookies"' EXIT
csrf=$(curl --fail --silent --show-error --cookie-jar "$cookies" --header 'x-heed-csrf: dev-sign-in' \
  --header "origin: $web" --header 'content-type: application/json' \
  --data '{"email":"per_ravi@example.test"}' "$web/api/v1/auth/sign-in" |
  node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).csrfToken')
call() {
  curl --fail-with-body --silent --show-error --cookie "$cookies" --header "x-heed-csrf: $csrf" \
    --header "origin: $web" --header 'content-type: application/json' "$@"
}

added=$(call --header "idempotency-key: $(node -p 'crypto.randomUUID()')" --data \
  '{"type":"dbt-metricflow","name":"dbt","config":{"location":"address"},"secrets":{"fileAddress":"https://example.com/semantic_manifest.json"},"reason":"Checking the secret store"}' \
  "$web/api/v1/sources") || fail "the source is added: $added"
id=$(node -pe 'JSON.parse(process.argv[1]).id' "$added")

docker compose up --detach --wait --wait-timeout 120 --force-recreate heed web
csrf=$(curl --fail --silent --show-error --cookie-jar "$cookies" --header 'x-heed-csrf: dev-sign-in' \
  --header "origin: $web" --header 'content-type: application/json' \
  --data '{"email":"per_ravi@example.test"}' "$web/api/v1/auth/sign-in" |
  node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).csrfToken')
kept=$(call "$web/api/v1/sources/$id")
node -e '
  const { secrets } = JSON.parse(process.argv[1])
  if (!secrets.some((s) => s.key === "fileAddress" && s.set)) process.exit(1)
' "$kept" || fail "the secret is still there in a new container: $kept"
call --request POST --header "idempotency-key: $(node -p 'crypto.randomUUID()')" \
  --data '{"reason":"Checked the secret store"}' "$web/api/v1/sources/$id/disconnect" > /dev/null ||
  fail 'the source is removed'
echo 'ok - a connector secret is kept across a new container'
