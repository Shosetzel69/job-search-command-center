#!/usr/bin/env bash
# JSCC #589 F1 HIGH — historical project-wide grant method RETIRED.
# The original version was applied once and failed independent security review.
# Do not re-apply it. Its exact contents remain in Git history for audit.
set -Eeuo pipefail
echo 'BLOCKED_F1_HIGH: project-wide observer roles are not resource-scoped.' >&2
echo 'Use scripts/gcp/remediate_589_f1_service_scoped_iam.sh only after the IAM-change approval.' >&2
exit 4
