let commandIdToken = null;
let commandUserEmail = null;
let commandPolling = false;

function authToast(message) {
  if (typeof toast === 'function') toast(message);
  else console.log(message);
}

function injectAuthStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .command-actions{display:flex;align-items:center;gap:10px}
    .command-user{height:40px;border:1px solid #188861;background:#188861;color:#fff;border-radius:9px;padding:0 12px;font:600 12px "DM Sans",sans-serif;cursor:pointer;max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-shadow:0 4px 12px rgba(24,136,97,.18)}
    .command-user:hover{background:#13704f;border-color:#13704f}
    .command-auth-error{font-size:12px;color:#a65b32;max-width:220px}
    .primary:disabled{background:#aeb8c7;box-shadow:none;cursor:not-allowed}
    @media(max-width:760px){.command-actions{gap:6px}.command-user{max-width:110px;padding:0 8px}.command-actions>div:first-child{max-width:130px;overflow:hidden}}
  `;
  document.head.appendChild(style);
}

function installAuthControls() {
  const runButton = document.querySelector('#runSearch');
  if (!runButton || document.querySelector('#commandActions')) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'commandActions';
  wrapper.className = 'command-actions';

  const signIn = document.createElement('div');
  signIn.id = 'googleSignIn';

  const userButton = document.createElement('button');
  userButton.id = 'commandUser';
  userButton.className = 'command-user';
  userButton.type = 'button';
  userButton.hidden = true;
  userButton.title = 'Deconecteaza contul Google';
  userButton.onclick = () => signOutCommandUser();

  const parent = runButton.parentElement;
  parent.insertBefore(wrapper, runButton);
  wrapper.append(signIn, userButton, runButton);
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-google-identity]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Google Identity Services nu a putut fi incarcat.'));
    document.head.appendChild(script);
  });
}

async function commandApi(path, options = {}, token = commandIdToken) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const response = await fetch(path, { ...options, headers, cache: 'no-store' });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }

  if (!response.ok) {
    if (response.status === 401 && token === commandIdToken) signOutCommandUser(false);
    const error = new Error(payload?.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function setAuthenticatedUi(email) {
  const signIn = document.querySelector('#googleSignIn');
  const userButton = document.querySelector('#commandUser');
  if (signIn) signIn.hidden = true;
  if (userButton) {
    userButton.hidden = false;
    userButton.textContent = email || 'Google conectat';
  }
}

function setSignedOutUi() {
  const signIn = document.querySelector('#googleSignIn');
  const userButton = document.querySelector('#commandUser');
  if (signIn) signIn.hidden = false;
  if (userButton) userButton.hidden = true;
}

function signOutCommandUser(showMessage = true) {
  commandIdToken = null;
  commandUserEmail = null;
  try { window.google?.accounts?.id?.disableAutoSelect(); } catch {}
  setSignedOutUi();
  if (showMessage) authToast('Contul Google a fost deconectat din aceasta sesiune.');
}

async function acceptGoogleCredential(credential) {
  try {
    const session = await commandApi('/auth/session', { method: 'POST' }, credential);
    commandIdToken = credential;
    commandUserEmail = session?.email || null;
    setAuthenticatedUi(commandUserEmail);
    authToast('Autentificare Google reusita.');
  } catch (error) {
    commandIdToken = null;
    commandUserEmail = null;
    setSignedOutUi();
    authToast(error.status === 403 ? 'Contul Google nu este autorizat pentru aceasta aplicatie.' : `Autentificare esuata: ${error.message}`);
  }
}

async function initializeGoogleAuth() {
  installAuthControls();
  try {
    const config = await commandApi('/auth/config');
    if (!config?.configured || !config?.client_id) {
      throw new Error('Autentificarea Google nu este configurata complet.');
    }

    await loadGoogleIdentityScript();
    window.google.accounts.id.initialize({
      client_id: config.client_id,
      callback: ({ credential }) => acceptGoogleCredential(credential),
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    window.google.accounts.id.renderButton(document.querySelector('#googleSignIn'), {
      theme: 'outline',
      size: 'medium',
      shape: 'rectangular',
      text: 'signin_with',
    });
  } catch (error) {
    console.error(error);
    const signIn = document.querySelector('#googleSignIn');
    if (signIn) {
      signIn.className = 'command-auth-error';
      signIn.textContent = 'Google login indisponibil';
    }
  }
}

function requireCommandAuth() {
  if (commandIdToken) return true;
  authToast('Conecteaza-te cu Google pentru aceasta actiune.');
  return false;
}

function setRunBusy(busy, label = null) {
  const button = document.querySelector('#runSearch');
  if (!button) return;
  button.disabled = busy;
  button.innerHTML = busy ? `<span>↻</span> ${label || 'Verificare in curs...'}` : '<span>↻</span> Ruleaza verificarea';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollForCompletedRun(previousRunId, previousCompletedAt) {
  if (commandPolling) return;
  commandPolling = true;
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      await sleep(5000);
      const response = await fetch(`./data/run-status.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) continue;
      const status = await response.json();
      const changed = status.run_id !== previousRunId || status.completed_at !== previousCompletedAt;
      if (!changed) continue;

      if (typeof runStatus !== 'undefined') runStatus = status;
      if (typeof updateRunStatus === 'function') updateRunStatus();
      if (typeof loadData === 'function') await loadData();
      if (typeof loadCriteria === 'function') loadCriteria();
      if (typeof render === 'function') render();

      if (status.status === 'completed' || status.status === 'completed_with_errors') {
        authToast(`Verificare finalizata: ${status.jobs_published ?? 0} joburi publicate.`);
      } else if (status.status === 'failed') {
        authToast('Verificarea s-a terminat cu eroare. Vezi starea ultimei rulari.');
      }
      return;
    }
    authToast('Verificarea a fost pornita, dar rezultatul nu a fost publicat inca.');
  } finally {
    commandPolling = false;
  }
}

async function runSearchFromUi() {
  if (!requireCommandAuth()) return;
  const previousRunId = typeof runStatus !== 'undefined' ? runStatus?.run_id : null;
  const previousCompletedAt = typeof runStatus !== 'undefined' ? runStatus?.completed_at : null;
  setRunBusy(true);
  try {
    await commandApi('/commands/run', { method: 'POST' });
    const runState = document.querySelector('#runState');
    if (runState) runState.textContent = 'Verificare in curs';
    authToast('Verificarea a fost pornita in GitHub Actions.');
    await pollForCompletedRun(previousRunId, previousCompletedAt);
  } catch (error) {
    if (error.status === 409) {
      authToast('Exista deja o verificare in curs.');
      await pollForCompletedRun(previousRunId, previousCompletedAt);
    } else {
      authToast(`Nu am putut porni verificarea: ${error.message}`);
    }
  } finally {
    setRunBusy(false);
  }
}

async function saveCriteriaToServer() {
  if (!requireCommandAuth()) return;
  const button = document.querySelector('#saveCriteria');
  const state = document.querySelector('#criteriaState');
  const originalText = button?.textContent || 'Salveaza preferintele';

  const criteria = typeof currentCriteria === 'function' ? currentCriteria() : {};
  criteria.rateMin = Number(document.querySelector('#rateMin')?.value || 0);
  criteria.rateMax = Number(document.querySelector('#rateMax')?.value || 0);

  if (button) { button.disabled = true; button.textContent = 'Se salveaza...'; }
  try {
    await commandApi('/config', { method: 'PUT', body: JSON.stringify(criteria) });
    if (typeof savedCriteria !== 'undefined') savedCriteria = criteria;
    localStorage.setItem('selectionCriteria', JSON.stringify(criteria));
    if (state) {
      state.textContent = 'Preferinte salvate';
      state.classList.remove('dirty');
    }
    authToast('Preferintele au fost salvate. O noua verificare va porni automat.');
  } catch (error) {
    authToast(`Preferintele nu au putut fi salvate: ${error.message}`);
  } finally {
    if (button) { button.disabled = false; button.textContent = originalText; }
  }
}

function overrideCommandHandlers() {
  const runButton = document.querySelector('#runSearch');
  const saveButton = document.querySelector('#saveCriteria');
  if (runButton) runButton.onclick = runSearchFromUi;
  if (saveButton) saveButton.onclick = saveCriteriaToServer;
}

async function initCommandIntegration() {
  injectAuthStyles();
  overrideCommandHandlers();
  await initializeGoogleAuth();
}

initCommandIntegration();