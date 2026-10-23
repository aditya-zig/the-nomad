#!/usr/bin/env bash
# One isolated game browser; does not touch unrelated browsers, apps or tabs.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
root="$PWD"
for tool in systemd-run systemctl node; do
  command -v "$tool" >/dev/null || { echo "Missing $tool. Use pnpm dev and ONE desktop browser instead." >&2; exit 1; }
done
[[ -f node_modules/vite/bin/vite.js ]] || { echo 'Install dependencies first: pnpm install --frozen-lockfile' >&2; exit 1; }
if systemctl --user is-active --quiet nomad-browser.service; then
  echo 'The capped Nomad browser is already running. Not launching a second instance.'
  exit 0
fi
available_kb=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
if (( available_kb < 1843200 )); then
  echo 'Less than 1.8 GiB RAM available. Close unneeded apps yourself, then retry.' >&2
  exit 1
fi
chrome=''
for candidate in google-chrome-stable google-chrome chromium chromium-browser; do
  if command -v "$candidate" >/dev/null; then chrome=$(command -v "$candidate"); break; fi
done
[[ -n "$chrome" ]] || { echo 'No Chrome/Chromium executable found.' >&2; exit 1; }
if ! systemctl --user is-active --quiet nomad-dev.service; then
  systemd-run --user --unit=nomad-dev --collect \
    -p MemoryMax=384M -p MemorySwapMax=0 --working-directory="$root" \
    env NODE_OPTIONS=--max-old-space-size=256 "$(command -v node)" \
    "$root/node_modules/vite/bin/vite.js" --host 127.0.0.1 --port 5314 --strictPort
  sleep 2
  systemctl --user is-active --quiet nomad-dev.service || {
    echo 'The server could not start; check journalctl --user -u nomad-dev.' >&2; exit 1;
  }
fi
systemd-run --user --unit=nomad-browser --collect \
  -p MemoryMax=1280M -p MemorySwapMax=0 \
  env DISPLAY="${DISPLAY:-}" WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-}" XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-}" \
  "$chrome" --user-data-dir="${XDG_CACHE_HOME:-$HOME/.cache}/nomad-ashfall-browser" \
  --no-first-run --no-default-browser-check --disable-extensions --disable-dev-shm-usage \
  --enable-gpu --ignore-gpu-blocklist --use-angle=gl --ozone-platform=x11 \
  --window-size=1280,800 --js-flags=--max-old-space-size=384 http://127.0.0.1:5314
printf '\nNomad: http://127.0.0.1:5314\n'
printf 'Stop only this game: systemctl --user stop nomad-browser nomad-dev\n'
printf 'RAM caps protect the browser process tree, not independent GPU/driver allocations.\n'
