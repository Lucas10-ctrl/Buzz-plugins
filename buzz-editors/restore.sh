#!/usr/bin/env bash
# Rebuild the Buzz Editors source checkout: upstream buzz-app at the base commit,
# plus this folder's patch and added files.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
target="${1:?usage: restore.sh <new-folder>}"
base="$(cat "$here/BASE_COMMIT")"
git clone https://github.com/block/buzz-app.git "$target"
cd "$target"
git checkout --detach "$base"
git apply --binary "$here/upstream.patch"
cp -a "$here/overlay/." ./
echo "Restored at $target (buzz-app $base + Buzz Editors changes)."
