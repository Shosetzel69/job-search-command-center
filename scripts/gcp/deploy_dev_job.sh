#!/usr/bin/env bash
set -euo pipefail
echo "DEPRECATED: use scripts/gcp/promote.sh dev <candidate-sha>" >&2
exec "$(dirname "$0")/promote.sh" dev "${1:?candidate SHA is required}"
