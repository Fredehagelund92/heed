#!/usr/bin/env bash
# Boots the service image as it ships, in production mode, against a stand-in OpenID Connect
# provider, behind the web image's nginx, on a PostgreSQL 18 container (the CI job "Docker images:
# build, and boot the service in production mode"). Build the images first:
#
#   docker compose build && bash tests/image/production-boot.sh
#
# It checks, in this order:
#   1. With only database settings the image starts in production mode and refuses to start
#      without company sign-in, saying how to get the demo instead.
#   2. With OpenID Connect settings and the keys made by node src/server/create-keys.ts, it
#      starts, signs a person in and serves an agent's MCP call (tests/image/production-check.ts).
#   3. Behind nginx, each caller before sign-in has a request limit of its own, and an address a
#      caller makes up is dropped (tests/image/limit-probe.ts). The service trusts every private
#      address (CL_TRUSTED_PROXIES=uniquelocal, as compose.yaml does), so a made-up address that
#      nginx passed on would win and fail the probe.
#
# Everything it makes is named heed-boot-<pid> and removed at the end. HEED_SERVICE_IMAGE and
# HEED_WEB_IMAGE name other images; HEED_BOOT_SUBNET (three octets) moves its private network.
set -euo pipefail

service_image=${HEED_SERVICE_IMAGE:-heed-heed}
web_image=${HEED_WEB_IMAGE:-heed-web}
subnet=${HEED_BOOT_SUBNET:-172.31.213}
run=heed-boot-$$
root=$(cd "$(dirname "$0")/../.." && pwd)
web_ip=$subnet.10
public_origin=https://heed.example.test

passed=false
cleanup() {
  if [ "$passed" != true ]; then
    for name in refuse service web; do
      echo "::group::$name log"
      docker logs "$run-$name" 2>&1 | tail -n 200 || true
      echo "::endgroup::"
    done
  fi
  docker rm -f "$run-refuse" "$run-service" "$run-web" "$run-db" > /dev/null 2>&1 || true
  docker volume rm "$run-keys" > /dev/null 2>&1 || true
  docker network rm "$run" > /dev/null 2>&1 || true
}
trap cleanup EXIT
fail() {
  echo "not ok - $1" >&2
  exit 1
}

docker network create --subnet "$subnet.0/24" "$run" > /dev/null ||
  fail "the private network $subnet.0/24 is made (HEED_BOOT_SUBNET moves it)"
docker run -d --name "$run-db" --network "$run" -e POSTGRES_HOST_AUTH_METHOD=trust \
  postgres:18.6@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336 > /dev/null
for _ in $(seq 60); do
  if docker exec "$run-db" pg_isready -U postgres > /dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$run-db" pg_isready -U postgres > /dev/null || fail 'PostgreSQL is ready'

# As compose.yaml connects: the superuser makes the roles and the database, then each part of
# the service takes its own role.
database=(
  -e "DATABASE_URL_BOOTSTRAP=postgres://postgres@$run-db:5432/postgres"
  -e "DATABASE_URL_MIGRATE=postgres://context_layer_owner@$run-db:5432/heed"
  -e "DATABASE_URL=postgres://context_layer_api@$run-db:5432/heed"
)

# 1. No setting but the database: production mode, which refuses to start without sign-in.
docker run -d --name "$run-refuse" --network "$run" "${database[@]}" "$service_image" > /dev/null
for _ in $(seq 120); do
  if [ "$(docker inspect -f '{{.State.Running}}' "$run-refuse")" != true ]; then break; fi
  sleep 1
done
output=$(docker logs "$run-refuse" 2>&1)
if [ "$(docker inspect -f '{{.State.Running}}' "$run-refuse")" = true ]; then
  fail "the image refuses to start without company sign-in (still running after 120 seconds)"$'\n'"$output"
fi
if [ "$(docker inspect -f '{{.State.ExitCode}}' "$run-refuse")" = 0 ]; then
  fail "the image refuses to start without company sign-in"$'\n'"$output"
fi
grep -q 'CL_OIDC_ISSUER: Required when CL_AUTH=oidc' <<< "$output" ||
  fail "the refusal names the sign-in settings"$'\n'"$output"
grep -q 'set NODE_ENV=development, as compose.yaml does' <<< "$output" ||
  fail "the refusal says how to get the demo instead"$'\n'"$output"
echo 'ok - with no settings the image starts in production mode and refuses to start without company sign-in'

# 2. Production with company sign-in. Production makes no key of its own.
docker volume create "$run-keys" > /dev/null
docker run --rm -v "$run-keys:/var/lib/heed" "$service_image" node src/server/create-keys.ts
docker run -d --name "$run-service" --network "$run" "${database[@]}" \
  -v "$run-keys:/var/lib/heed" \
  -e "MCP_RESOURCE_URL=$public_origin/mcp" \
  -e "CL_WEB_ORIGINS=$public_origin" \
  -e CL_OIDC_ISSUER=http://127.0.0.1:9400 \
  -e CL_OIDC_CLIENT_ID=heed-test \
  -e CL_OIDC_ADMIN_GROUPS=heed-admins \
  -e CL_TRUSTED_PROXIES=uniquelocal \
  "$service_image" > /dev/null
docker run -d --name "$run-web" --network "$run" --ip "$web_ip" \
  -e "HEED_API_URL=http://$run-service:3000" "$web_image" > /dev/null
# The check shares the service's network, where the provider it starts is on 127.0.0.1 too.
docker run --rm --network "container:$run-service" -v "$root/tests:/app/tests:ro" \
  -e "PUBLIC_ORIGIN=$public_origin" -e "WEB_URL=http://$web_ip" -e ISSUER_PORT=9400 \
  "$service_image" node tests/image/production-check.ts
log=$(docker logs "$run-service" 2>&1)
grep -q '"nodeEnv":"production"' <<< "$log" || fail 'the service ran in production mode'
if grep -q 'people picker' <<< "$log"; then fail 'production has no people picker'; fi

# 3. Two callers behind nginx, each with an address of its own. The first uses up its 120
# requests a minute before sign-in; the second still gets in, though it claims the first's
# address.
probe() { # address, then the probe's arguments
  local address=$1
  shift
  docker run --rm --network "$run" --ip "$address" -v "$root/tests:/app/tests:ro" \
    "$service_image" node tests/image/limit-probe.ts "http://$web_ip/api/v1/auth/methods" "$@"
}
first=$(probe "$subnet.21" 121)
[ "$first" = '{"calls":121,"limited":1,"last":429}' ] ||
  fail "the first caller is limited after 120 requests, and only then (got $first)"
second=$(probe "$subnet.22" 1 "$subnet.21")
[ "$second" = '{"calls":1,"limited":0,"last":200}' ] ||
  fail "a second caller behind the same proxy has a limit of its own (got $second)"
echo 'ok - behind nginx each caller before sign-in has a request limit of its own'

passed=true
echo 'The service image boots in production mode.'
