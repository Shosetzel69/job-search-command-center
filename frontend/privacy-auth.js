(() => {
  function hidePrivateUi() {
    document.body.classList.add('auth-signed-out');
    document.body.classList.remove('auth-authenticated');

    const drawer = document.querySelector('#drawer');
    const scrim = document.querySelector('#scrim');
    if (drawer) {
      drawer.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
    }
    if (scrim) scrim.classList.remove('open');
  }

  function showPrivateUi() {
    document.body.classList.remove('auth-signed-out');
    document.body.classList.add('auth-authenticated');
  }

  const originalAuthenticatedUi = window.setAuthenticatedUi;
  if (typeof originalAuthenticatedUi === 'function') {
    window.setAuthenticatedUi = function setAuthenticatedUiWithPrivacy(email) {
      originalAuthenticatedUi(email);
      showPrivateUi();
    };
  }

  const originalSignedOutUi = window.setSignedOutUi;
  if (typeof originalSignedOutUi === 'function') {
    window.setSignedOutUi = function setSignedOutUiWithPrivacy() {
      originalSignedOutUi();
      hidePrivateUi();
    };
  }

  hidePrivateUi();
})();
