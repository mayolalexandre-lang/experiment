#!/usr/bin/env bash
# deploy.sh — met a jour l experience tarification eau/electricite sur le VPS.
# Idempotent. Echoue franchement a la moindre erreur.
set -euo pipefail

REPO=/var/www/experiment
VENV="$REPO/.venv"

fail() { echo "❌ Deploiement ECHOUE a l etape : $1"; exit 1; }

echo "▶ Deploiement experiment — $(date "+%Y-%m-%d %H:%M:%S")"
cd "$REPO" || fail "repo introuvable ($REPO)"

echo "• git pull"
BEFORE=$(git rev-parse --short HEAD)
git pull --ff-only || fail "git pull (divergence ? resoudre manuellement)"
AFTER=$(git rev-parse --short HEAD)
[ "$BEFORE" = "$AFTER" ] && echo "  aucun nouveau commit ($AFTER)" || echo "  $BEFORE → $AFTER"

echo "• dependances"
"$VENV/bin/pip" install -q -r requirements.txt || fail "pip install"

echo "• redemarrage du service"
sudo systemctl restart experiment
sleep 2
systemctl is-active --quiet experiment || fail "experiment inactif (journalctl -u experiment -n 50)"

echo "• verification post-deploiement"
curl -fsS -m 5 http://127.0.0.1:8002/healthz >/dev/null || fail "healthz KO apres restart"

echo "✅ Deploiement termine ($AFTER) — $(date "+%H:%M:%S")"
