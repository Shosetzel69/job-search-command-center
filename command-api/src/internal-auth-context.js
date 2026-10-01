const contexts = new WeakMap();

export function withInternalAuthContext(request, context) {
  if (!(request instanceof Request)) throw new TypeError('Request is required');
  if (!context?.user_id || !context?.profile_id) throw new TypeError('Complete AuthContext is required');
  const forwarded = new Request(request);
  contexts.set(forwarded, Object.freeze({ ...context }));
  return forwarded;
}

export function internalAuthContext(request) {
  return contexts.get(request) || null;
}
