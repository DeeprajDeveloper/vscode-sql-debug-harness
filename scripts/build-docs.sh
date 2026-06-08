#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Compiling docs SCSS..."
if command -v npx >/dev/null 2>&1; then
  npx --yes sass docs/scss/styles.scss:docs/scss/css/styles.css --style=compressed
else
  sass docs/scss/styles.scss docs/scss/css/styles.css --style=compressed
fi

echo "Syncing version.json from package.json..."
node -e "
const pkg = require('./package.json');
require('fs').writeFileSync('docs/version.json', JSON.stringify({ version: pkg.version }, null, 2) + '\n');
"

if [[ "${1:-}" == "--pdf" ]]; then
  echo "Generating TECHNICAL_DESIGN.pdf..."
  if command -v npx >/dev/null 2>&1; then
    npx --yes md-to-pdf docs/TECHNICAL_DESIGN.md --config-file docs/md-to-pdf.config.js
  else
    echo "md-to-pdf not available. Install with: npm install -D md-to-pdf" >&2
    exit 1
  fi
fi

echo "Done. Open docs/index.html or run: npm run docs:serve"
