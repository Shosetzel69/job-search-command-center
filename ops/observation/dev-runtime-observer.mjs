// JSCC #589 ATC-589-R1-01: read-only DEV observer core.
// No credentials, shell, IAM or deployment calls. Integrate only through
// independently reviewed R33 gateway source and a scoped observation identity.
const PROJECT = 'jscc-dev';
const BUILD_PROJECT = 'jscc-shared';
const REGION = 'europe-west1';
const SERVICES = Object.freeze([
  'jscc-dev-workspace-manager',
  'jscc-dev-sandbox-worker',
  'jscc-ops-gateway-dev',
  'jscc-command-api-dev',
]);
const SERVICE_SET = new Set(SERVICES);
const BUILD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGEST = /(?:^|@)(sha256:[0-9a-f]{64})$/;

export function admitDevRequest(request = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('invalid_request');
  const keys = Object.keys(request);
  const { environment, task, service, buildId } = request;
  if (environment !== 'dev') throw new Error('environment_denied');
  if (keys.some(k => !['environment','task','service','buildId'].includes(k)))
    throw new Error('resource_denied');
  if (task === 'describe_dev_runtime') {
    if (!SERVICE_SET.has(service) || buildId !== undefined) throw new Error('resource_denied');
    return Object.freeze({ environment: 'dev', task, service });
  }
  if (task === 'describe_dev_build') {
    if (service !== undefined || typeof buildId !== 'string' || !BUILD_ID.test(buildId))
      throw new Error('resource_denied');
    return Object.freeze({ environment: 'dev', task, buildId });
  }
  throw new Error('task_denied');
}

function safeDigest(s) {
  const found = typeof s === 'string' ? DIGEST.exec(s) : null;
  return found ? found[1] : 'UNKNOWN';
}
function safeRevision(value, service) {
  if (typeof value !== 'string') return 'UNKNOWN';
  const prefix = `projects/${PROJECT}/locations/${REGION}/services/${service}/revisions/`;
  const shortName = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  return shortName.startsWith(service + '-') &&
    /^[a-z0-9-]{1,100}$/.test(shortName) ? shortName : 'UNKNOWN';
}
function trafficRows(service, name) {
  const rows = Array.isArray(service.trafficStatuses) ? service.trafficStatuses :
    Array.isArray(service.traffic) ? service.traffic : [];
  return rows.map(row => ({
    revision: safeRevision(row.revision || row.revisionName, name),
    percent: Number.isInteger(row.percent) && row.percent >= 0 && row.percent <= 100
      ? row.percent : null,
  })).filter(row => row.revision !== 'UNKNOWN' && row.percent !== null);
}
function statusOf(http) {
  return Number.isInteger(http?.status) ? http.status : 0;
}
function blocked(status) {
  if (status === 401 || status === 403) throw new Error('PERMISSION_BLOCKED');
  throw new Error('OBSERVATION_UNAVAILABLE');
}
function resultData(reply) {
  if (!reply || statusOf(reply) !== 200 || !reply.body || typeof reply.body !== 'object')
    blocked(statusOf(reply));
  return reply.body;
}
function trustedTransport(transport) {
  if (typeof transport !== 'function') throw new Error('transport_required');
  return transport;
}
export function createDevObserver({ transport, now = () => new Date().toISOString() }) {
  const get = trustedTransport(transport);
  return Object.freeze({
    async describe(request) {
      const admitted = admitDevRequest(request);
      const capturedAt = now();
      if (admitted.task === 'describe_dev_build') {
        const path = `/v1/projects/${BUILD_PROJECT}/locations/${REGION}/builds/${admitted.buildId}`;
        const data = resultData(await get({ api: 'cloudbuild.googleapis.com', path }));
        if (data.id !== admitted.buildId) throw new Error('RESOURCE_MISMATCH');
        return Object.freeze({
          environment: 'dev', task: admitted.task,
          resource: `projects/${BUILD_PROJECT}/locations/${REGION}/builds/${admitted.buildId}`,
          build_id: admitted.buildId,
          build_status: typeof data.status === 'string' &&
            /^[A-Z_]{1,36}$/.test(data.status) ? data.status : 'UNKNOWN',
          source_sha: 'UNKNOWN',
          observed_at: capturedAt,
        });
      }
      const { service } = admitted;
      const path = `/v2/projects/${PROJECT}/locations/${REGION}/services/${service}`;
      const data = resultData(await get({ api: 'run.googleapis.com', path }));
      const expected = `projects/${PROJECT}/locations/${REGION}/services/${service}`;
      if (data.name !== expected) throw new Error('RESOURCE_MISMATCH');
      const traffic = trafficRows(data, service);
      const total = traffic.reduce((sum, item) => sum + item.percent, 0);
      if (!traffic.length || total !== 100) throw new Error('INSUFFICIENT_EVIDENCE');
      // Do not confuse latestReadyRevision with effective traffic.
      const revisions = [];
      for (const item of traffic) {
        const revPath = `/v2/projects/${PROJECT}/locations/${REGION}/services/${service}/revisions/${item.revision}`;
        const revision = resultData(await get({ api: 'run.googleapis.com', path: revPath }));
        if (revision.name !== revPath.slice(4)) throw new Error('RESOURCE_MISMATCH');
        revisions.push(Object.freeze({
          revision: item.revision, percent: item.percent,
          image_digest: safeDigest(revision.imageDigest ||
            revision.containers?.[0]?.imageDigest || revision.containers?.[0]?.image),
        }));
      }
      return Object.freeze({
        environment: 'dev', task: admitted.task, resource: expected,
        effective_revisions: revisions,
        source_sha: 'UNKNOWN', observed_at: capturedAt,
      });
    },
  });
}

export const DEV_OBSERVATION_TARGETS = SERVICES;
