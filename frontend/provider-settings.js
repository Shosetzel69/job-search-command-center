(() => {
  const originalCurrentCriteria = currentCriteria;
  const originalLoadCriteria = loadCriteria;

  currentCriteria = function currentCriteriaWithProviders() {
    const criteria = originalCurrentCriteria();
    const checkbox = document.querySelector('#jobspipeEnabled');
    criteria.jobspipeEnabled = checkbox ? checkbox.checked : true;
    return criteria;
  };

  loadCriteria = function loadCriteriaWithProviders() {
    originalLoadCriteria();
    const checkbox = document.querySelector('#jobspipeEnabled');
    if (!checkbox) return;

    if (savedCriteria && typeof savedCriteria.jobspipeEnabled === 'boolean') {
      checkbox.checked = savedCriteria.jobspipeEnabled;
      return;
    }

    checkbox.checked = canonicalConfig?.jobspipe_enabled !== false;
  };
})();
