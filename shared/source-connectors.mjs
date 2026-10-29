import registry from './source-connectors.json' with { type: 'json' };

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
    if (parsed.protocol === 'https:'
      && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.zohorecruit\.com$/.test(parsed.hostname)
      && (parsed.pathname === '/careers' || parsed.pathname === '/careers/')
      && !parsed.search && !parsed.hash) return 'zoho_recruit';
    return 'web';
  } catch {
    return null;
  }
}
