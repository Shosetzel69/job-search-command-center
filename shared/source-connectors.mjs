import registry from './source-connectors.json';

export function sourceConnector(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
    return Object.keys(registry).find(key => registry[key].hosts.includes(parsed.hostname)) || null;
  } catch {
    return null;
  }
}

export function sourceCollectionMethod(url) {
  const dedicated = sourceConnector(url);
  if (dedicated) return dedicated;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) return null;
    return 'web';
  } catch {
    return null;
  }
}
