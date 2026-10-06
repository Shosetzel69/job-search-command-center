export async function registerPwa(target = globalThis) {
  const navigator = target?.navigator;
  const location = target?.location;
  if (!navigator?.serviceWorker) return null;
  const secure = location?.protocol === 'https:' || ['localhost','127.0.0.1'].includes(location?.hostname);
  if (!secure) return null;
  return navigator.serviceWorker.register('/sw.js', { scope:'/' });
}
