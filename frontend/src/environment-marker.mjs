export function environmentBadge(environment) {
  const value = String(environment || '').trim().toLowerCase();
  if (value === 'dev') return 'DEV';
  if (value === 'test') return 'TEST';
  if (value === 'prod') return 'PROD';
  return 'UNKNOWN';
}


export function releaseVersionLabel(version) {
  const value = String(version || '').trim();
  return value ? `v${value}` : 'v?';
}
