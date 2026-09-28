import { readFileSync } from 'node:fs';

const dockerfile = readFileSync('Dockerfile', 'utf8');
const cloudbuild = readFileSync('cloudbuild.yaml', 'utf8');

function requireMatch(value, pattern, message) {
  if (!pattern.test(value)) {
    throw new Error(message);
  }
}

requireMatch(
  dockerfile,
  /mcr\.microsoft\.com\/playwright\/python:v1\.55\.0-noble/,
  'Dockerfile must pin the Playwright 1.55.0 runtime image'
);
requireMatch(
  dockerfile,
  /org\.opencontainers\.image\.revision="\$\{GIT_SHA\}"/,
  'Dockerfile must stamp the Git SHA as OCI revision metadata'
);
requireMatch(
  dockerfile,
  /ENTRYPOINT \["python3", "scripts\/job_search_runner\.py"\]/,
  'Dockerfile must preserve the existing search-runner entry point'
);

for (const forbidden of [/NILE_DATABASE_URL\s*=/, /APIFY_TOKEN\s*=/, /JOBSPIPE_API_KEY\s*=/]) {
  if (forbidden.test(dockerfile)) {
    throw new Error('Dockerfile must not embed runtime secrets');
  }
}

requireMatch(
  cloudbuild,
  /serviceAccount: projects\/jscc-shared\/serviceAccounts\/jscc-build@jscc-shared\.iam\.gserviceaccount\.com/,
  'Cloud Build must use the dedicated jscc-build identity'
);
requireMatch(
  cloudbuild,
  /europe-west1-docker\.pkg\.dev\/jscc-shared\/jscc\/jscc:\$\{_GIT_SHA\}/,
  'Cloud Build must push only the exact-SHA tag to the shared registry'
);
requireMatch(
  cloudbuild,
  /_GIT_SHA.*40-character Git SHA/s,
  'Cloud Build must validate a full exact Git SHA'
);
requireMatch(
  cloudbuild,
  /_GIT_SHA.*COMMIT_SHA/s,
  'Cloud Build must bind the declared candidate to Cloud Build COMMIT_SHA'
);
requireMatch(
  cloudbuild,
  /IMAGE_DIGEST=.*digest/,
  'Cloud Build must expose the immutable digest as build evidence'
);

for (const forbidden of [
  /gcloud\s+run\s+deploy/i,
  /gcloud\s+run\s+jobs\s+(deploy|update|execute)/i,
  /kubectl/i,
  /firebase\s+deploy/i,
]) {
  if (forbidden.test(cloudbuild)) {
    throw new Error('cloudbuild.yaml must remain build-only and must not deploy');
  }
}

console.log('GCP container/build contract validation: PASS');
