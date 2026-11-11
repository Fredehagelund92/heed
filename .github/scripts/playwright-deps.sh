#!/usr/bin/env bash
# Playwright's system packages for Chromium, without a hard dependency on the Ubuntu mirror.
#
# `npx playwright install-deps` runs apt-get update and apt-get install against the runner's
# default mirror, and a mirror outage fails every browser job. This installs the same packages in
# three tiers:
#   1. from the .deb files cached by an earlier run (no network),
#   2. from the mirror, retried with a backoff,
#   3. from a fallback mirror, after the default one kept failing.
# A successful network install leaves its .deb files in $DEBS for the cache step to save.
set -euo pipefail

DEBS=${PLAYWRIGHT_DEBS:-$HOME/.cache/playwright-debs}
ATTEMPTS=${PLAYWRIGHT_DEPS_ATTEMPTS:-4}
FALLBACK_MIRRORS=(http://mirrors.edge.kernel.org/ubuntu http://mirror.us.leaseweb.net/ubuntu)

mkdir -p "$DEBS"

# The packages Playwright reports as missing for this version, so the package set never drifts.
# --dry-run exits 1 when something is missing, so the status is read from the output instead.
report=$(npx playwright install-deps --dry-run chromium || true)
if grep -q "All system dependencies are installed" <<<"$report"; then
  echo "Playwright's system packages are already installed"
  exit 0
fi
packages=$(sed -n 's/^  \([a-z0-9][a-z0-9.+-]*\)$/\1/p' <<<"$report" | tr '\n' ' ')
if [ -z "$packages" ]; then
  echo "::error::playwright install-deps --dry-run listed no missing packages: $report"
  exit 1
fi
echo "Playwright system packages: $packages"

if ls "$DEBS"/*.deb >/dev/null 2>&1; then
  echo "Installing from the cached .deb files in $DEBS"
  if sudo dpkg -i "$DEBS"/*.deb; then
    exit 0
  fi
  echo "::warning::The cached packages did not install, falling back to the mirror"
fi

# shellcheck disable=SC2086 # $packages is a word list on purpose
apt_install() {
  sudo apt-get update -o Acquire::Retries=3 &&
    sudo apt-get install -y --no-install-recommends \
      -o Acquire::Retries=3 -o Dir::Cache::archives="$DEBS" --download-only $packages &&
    sudo apt-get install -y --no-install-recommends -o Dir::Cache::archives="$DEBS" $packages
}

use_mirror() {
  # Ubuntu 24.04 runners keep their sources in deb822 files, older images in sources.list.
  sudo sed -i -E "s#https?://[a-z0-9.-]*(archive|security)\.ubuntu\.com/ubuntu/?#$1#g" \
    /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list 2>/dev/null || true
}

delay=10
for attempt in $(seq 1 "$ATTEMPTS"); do
  if [ "$attempt" -gt 2 ]; then
    mirror=${FALLBACK_MIRRORS[$(((attempt - 3) % ${#FALLBACK_MIRRORS[@]}))]}
    echo "Switching the apt sources to $mirror"
    use_mirror "$mirror"
  fi
  if apt_install; then
    sudo chown -R "$(id -u):$(id -g)" "$DEBS"
    rm -rf "$DEBS/lock" "$DEBS/partial"
    exit 0
  fi
  echo "::warning::apt attempt $attempt of $ATTEMPTS failed"
  [ "$attempt" -lt "$ATTEMPTS" ] && sleep "$delay" && delay=$((delay * 2))
done

echo "::error::Could not install Playwright's system packages from any mirror"
exit 1
