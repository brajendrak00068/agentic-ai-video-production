#!/usr/bin/env bash
# install-hooks.sh — point this repo at the versioned hooks under .githooks/
# Run once per fresh clone.
set -eu
cd "$(dirname "$0")/.."
git config core.hooksPath .githooks
chmod +x .githooks/* scripts/*.sh
echo "✓ git hooks active (.githooks/pre-commit will run on every commit)"
