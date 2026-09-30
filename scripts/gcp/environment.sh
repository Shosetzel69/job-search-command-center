#!/usr/bin/env bash
set -euo pipefail

env_name="${1:-}"
case "${env_name}" in
  dev|test) ;;
  *) echo "environment must be dev or test" >&2; exit 2 ;;
esac

export JSCC_ENV="${env_name}"
export PROJECT_ID="jscc-${env_name}"
export REGION="europe-west1"
export JOB_NAME="jscc-search-${env_name}"
export SERVICE_NAME="jscc-command-api-${env_name}"
export RUNTIME_SA="jscc-${env_name}-runtime@jscc-${env_name}.iam.gserviceaccount.com"
export SEARCH_MODE="$([ "${env_name}" = "dev" ] && echo disabled || echo smoke)"
export EXPECTED_DATABASE="jobsearch_${env_name}"

project_number="$(gcloud projects describe "${PROJECT_ID}" --project="${PROJECT_ID}" --format='value(projectNumber)')"
test -n "${project_number}" || { echo "Unable to resolve project number for ${PROJECT_ID}" >&2; exit 3; }
export PROJECT_NUMBER="${project_number}"
export RUNTIME_BUCKET="jscc-${env_name}-runtime-${project_number}"

export JOB_IMAGE_REPO="europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc"
export SERVICE_IMAGE_REPO="europe-west1-docker.pkg.dev/jscc-shared/jscc/jscc-service"
