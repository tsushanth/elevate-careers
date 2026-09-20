#!/bin/bash
# Idempotent installer, run ON the Mac mini. Sparse-clones only what the drip needs,
# installs one small dependency, and (re)loads the launch agent.
set -euo pipefail
BASE="$HOME/.simplyapply-drip"; ROOT="$HOME/simplyapply-drip-harness"; LABEL=com.simplyapply.email-drip
export PATH="/opt/homebrew/bin:/usr/bin:/bin"
mkdir -p "$BASE/logs" "$ROOT"
[ -d "$ROOT/repo/.git" ] || git clone -q --depth 1 --filter=blob:none --sparse https://github.com/tsushanth/elevate-careers.git "$ROOT/repo"
cd "$ROOT/repo"
git sparse-checkout set --no-cone /package.json /src/services/email.js /src/services/email-templates.js /harness/email-drip
git pull -q --ff-only
( cd harness/email-drip && npm install --no-audit --no-fund --loglevel=error )
[ -f "$BASE/env" ] || { echo "missing $BASE/env (see README.md)"; exit 1; }
chmod 600 "$BASE/env"
sed "s|__HOME__|$HOME|g" harness/email-drip/com.simplyapply.email-drip.plist.template > "$HOME/Library/LaunchAgents/$LABEL.plist"
U=$(id -u); launchctl bootout gui/$U/$LABEL 2>/dev/null || true
launchctl bootstrap gui/$U "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "installed and loaded $LABEL (5 runs/day, up to DRIP_MAX_PER_RUN emails each)"
