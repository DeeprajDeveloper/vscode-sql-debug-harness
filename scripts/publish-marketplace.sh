#!/usr/bin/env bash
# Publish SQL Debug Harness to the Visual Studio Marketplace.
#
# Prerequisites:
#   1. Azure DevOps PAT with Marketplace → Manage scope
#      (Organization: All accessible organizations)
#   2. Export it before running:
#        export VSCE_PAT="your-token-here"
#
# Usage:
#   ./scripts/publish-marketplace.sh           # test + package + publish
#   ./scripts/publish-marketplace.sh --dry-run # package only (no upload)
#   ./scripts/publish-marketplace.sh --skip-tests
#   ./scripts/publish-marketplace.sh --yes     # skip confirmation prompt
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DRY_RUN=0
SKIP_TESTS=0
ASSUME_YES=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --skip-tests) SKIP_TESTS=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Use --help for usage." >&2
      exit 1
      ;;
  esac
done

PUBLISHER="$(node -p "require('./package.json').publisher")"
NAME="$(node -p "require('./package.json').name")"
VERSION="$(node -p "require('./package.json').version")"
MARKETPLACE_URL="https://marketplace.visualstudio.com/items?itemName=${PUBLISHER}.${NAME}"
VSIX_OUT="dist/${NAME}.vsix"

echo "==> Publishing ${PUBLISHER}.${NAME}@${VERSION}"
echo "    Marketplace: ${MARKETPLACE_URL}"
echo

if [[ -z "${VSCE_PAT:-}" && "$DRY_RUN" -eq 0 ]]; then
  echo "ERROR: VSCE_PAT is not set." >&2
  echo >&2
  echo "Create a Personal Access Token at https://dev.azure.com" >&2
  echo "  Organization: All accessible organizations" >&2
  echo "  Scopes: Marketplace → Manage" >&2
  echo >&2
  echo "Then:" >&2
  echo "  export VSCE_PAT=\"your-token\"" >&2
  echo "  ./scripts/publish-marketplace.sh" >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "==> Installing dependencies"
  npm ci
fi

echo "==> Typecheck"
npm run check

if [[ "$SKIP_TESTS" -eq 0 ]]; then
  echo "==> Tests"
  npm test
else
  echo "==> Skipping tests (--skip-tests)"
fi

echo "==> Packaging VSIX"
mkdir -p dist
# vscode:prepublish runs compile via vsce; still package explicitly for a local artifact.
npx vsce package --out "$VSIX_OUT"
echo "    Wrote ${VSIX_OUT}"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo
  echo "Dry run complete — did not upload."
  echo "To publish for real:"
  echo "  export VSCE_PAT=\"your-token\""
  echo "  ./scripts/publish-marketplace.sh"
  exit 0
fi

if [[ "$ASSUME_YES" -eq 0 ]]; then
  echo
  read -r -p "Publish ${PUBLISHER}.${NAME}@${VERSION} to Marketplace? [y/N] " reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *)
      echo "Aborted."
      exit 1
      ;;
  esac
fi

echo "==> Uploading to Visual Studio Marketplace"
# Prefer env PAT (non-interactive). vsce also accepts -p.
npx vsce publish -p "$VSCE_PAT"

echo
echo "Published ${PUBLISHER}.${NAME}@${VERSION}"
echo "Listing (may take a few minutes to update):"
echo "  ${MARKETPLACE_URL}"
