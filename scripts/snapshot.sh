#!/bin/bash
# Быстрый снимок состояния в git
MSG="${1:-snapshot}"
cd "$(dirname "$0")/.." || exit 1
git add -A
git commit -m "$MSG

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
echo "✓ Снимок: $MSG"
git log --oneline -5
