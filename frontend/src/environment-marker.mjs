export function environmentBadge(environment) {
  const value = String(environment || '').trim().toLowerCase();
  if (value === 'dev') return 'DEV';
  if (value === 'test') return 'TEST';
  return null;
}
