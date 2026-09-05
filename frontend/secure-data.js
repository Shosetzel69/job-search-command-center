(() => {
  const nativeFetch = window.fetch.bind(window);

  window.fetch = function authenticatedDataFetch(input, init = {}) {
    try {
      const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      const url = new URL(rawUrl, window.location.href);
      if (url.origin === window.location.origin && url.pathname.startsWith('/data/') && commandIdToken) {
        const headers = new Headers(input instanceof Request ? input.headers : undefined);
        const extraHeaders = new Headers(init.headers || undefined);
        extraHeaders.forEach((value, key) => headers.set(key, value));
        headers.set('Authorization', `Bearer ${commandIdToken}`);
        return nativeFetch(input, { ...init, headers, cache: 'no-store' });
      }
    } catch (error) {
      console.error('Protected data fetch setup failed', error);
    }
    return nativeFetch(input, init);
  };

  async function reloadProtectedData() {
    if (typeof loadData !== 'function') return;
    await loadData();
    if (typeof loadCriteria === 'function') loadCriteria();

    try {
      const localSourceState = JSON.parse(localStorage.getItem('sourceState') || 'null');
      if (localSourceState && typeof sources !== 'undefined') {
        sources.forEach((source) => {
          if (Object.hasOwn(localSourceState, source.url)) source.active = Boolean(localSourceState[source.url]);
        });
      }
    } catch (error) {
      console.error('Local source state could not be restored', error);
    }

    if (typeof render === 'function') render();
  }

  function clearProtectedClientData() {
    if (typeof jobs !== 'undefined') jobs = [];
    if (typeof applications !== 'undefined') applications = [];
    if (typeof sources !== 'undefined') sources = [];
    if (typeof runStatus !== 'undefined') runStatus = null;
    if (typeof canonicalConfig !== 'undefined') canonicalConfig = null;
    if (typeof savedCriteria !== 'undefined') savedCriteria = null;
    if (typeof draftExclusions !== 'undefined') draftExclusions = [];
    if (typeof visible !== 'undefined') visible = [];

    const jobList = document.querySelector('#jobList');
    if (jobList) jobList.innerHTML = '';
    ['countJobs','countReview','countApplications','metricJobs','metricHigh','metricReposts','metricRemote','filterAll','filterHigh','filterRemote','filterB2b'].forEach((id) => {
      const element = document.querySelector(`#${id}`);
      if (element) element.textContent = '0';
    });
  }

  const originalAcceptGoogleCredential = window.acceptGoogleCredential;
  if (typeof originalAcceptGoogleCredential === 'function') {
    window.acceptGoogleCredential = async function acceptGoogleCredentialWithProtectedData(credential) {
      await originalAcceptGoogleCredential(credential);
      if (!commandIdToken) return;
      try {
        await reloadProtectedData();
      } catch (error) {
        console.error(error);
        authToast(`Datele protejate nu au putut fi incarcate: ${error.message}`);
      }
    };
  }

  const originalSignOutCommandUser = window.signOutCommandUser;
  if (typeof originalSignOutCommandUser === 'function') {
    window.signOutCommandUser = function signOutCommandUserWithDataClear(showMessage = true) {
      originalSignOutCommandUser(showMessage);
      clearProtectedClientData();
    };
  }
})();
