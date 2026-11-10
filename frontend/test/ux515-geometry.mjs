// #515. Dependency-free, real-DOM geometry checks for a populated JSCC job list.
// Browser usage (after an authorized DEV deploy): import this module in a browser
// runner and call captureJobGeometry(document), then evaluateJobGeometry(snapshot).
// The Node suite tests the same predicate with 25 deterministic row snapshots.
// A Node-only PASS is NOT a browser/DEV E2E PASS.

const rect = r => r && ({
  left: Number(r.left), right: Number(r.right),
  top: Number(r.top), bottom: Number(r.bottom),
  width: Number(r.width), height: Number(r.height),
});
// Closed <details> keeps its first <summary> visible, but hides other
// descendants. Hidden controls can still have nonzero bounding rectangles.
const hiddenByClosedDetails = node => {
  for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.tagName !== 'DETAILS' || ancestor.open) continue;
    const summary = Array.from(ancestor.children).find(child => child.tagName === 'SUMMARY');
    if (!summary || (node !== summary && !summary.contains(node))) return true;
  }
  return false;
};
const visible = (node, win) => {
  if (!node || hiddenByClosedDetails(node)) return false;
  // checkVisibility includes content-visibility, display and visibility on
  // ancestors; the explicit <details> guard also covers older browsers.
  if (typeof node.checkVisibility === 'function'
      && !node.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) {
    return false;
  }
  const box = node.getBoundingClientRect();
  const css = win.getComputedStyle(node);
  return box.width > 0 && box.height > 0
    && css.display !== 'none' && css.visibility !== 'hidden'
    && css.contentVisibility !== 'hidden' && css.opacity !== '0';
};
const overlap = (a, b, tolerance = 1) =>
  a && b && Math.min(a.right, b.right) - Math.max(a.left, b.left) > tolerance
    && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tolerance;

export function captureJobGeometry(doc) {
  const win = doc.defaultView;
  if (!win) throw new Error('An actual browser document/defaultView is required');
  const table = doc.querySelector('[data-testid="job-table"]');
  if (!table || !visible(table, win)) throw new Error('Visible populated job table not found');
  const rowNodes = Array.from(table.querySelectorAll('[data-testid="job-row"]'));
  return {
    viewportWidth: win.innerWidth,
    tableRect: rect(table.getBoundingClientRect()),
    rows: rowNodes.map((row, i) => {
      const role = row.querySelector('[data-testid="job-role"]');
      const published = row.querySelector('[data-testid="job-published"]');
      const desktop = row.querySelector('[data-testid="job-actions"]');
      const cards = row.querySelector('[data-testid="job-card-actions"]');
      const actions = visible(desktop, win) ? desktop : cards;
      const controls = actions ? Array.from(actions.querySelectorAll('button,a,summary'))
        .filter(node => visible(node, win))
        .map(node => ({
          rect: rect(node.getBoundingClientRect()),
          label: node.getAttribute('aria-label') || '',
          title: node.getAttribute('title') || '',
        })) : [];
      return {
        id: i + 1,
        rowRect: rect(row.getBoundingClientRect()),
        roleRect: role && visible(role, win) ? rect(role.getBoundingClientRect()) : null,
        publishedRect: published && visible(published, win)
          ? rect(published.getBoundingClientRect()) : null,
        actionsRect: actions && visible(actions, win)
          ? rect(actions.getBoundingClientRect()) : null,
        controls,
      };
    }),
  };
}

export function evaluateJobGeometry(snapshot, {minRows = 25} = {}) {
  const failures = [];
  const {viewportWidth, tableRect, rows} = snapshot;
  if (!Number.isFinite(viewportWidth) || !tableRect || !Array.isArray(rows)) {
    return {pass: false, failures: ['Invalid geometry snapshot'], checkedRows: 0};
  }
  if (rows.length < minRows) failures.push(`Expected at least ${minRows} populated job rows, got ${rows.length}`);
  if (tableRect.right > viewportWidth + 1 || tableRect.left < -1) {
    failures.push('Job table extends outside viewport');
  }
  for (const row of rows) {
    const p = `row ${row.id}:`;
    const {rowRect, roleRect, publishedRect, actionsRect, controls} = row;
    if (!rowRect || !roleRect || roleRect.width < 96) {
      failures.push(`${p} ROL not readable / zero-width role column`);
    }
    if (!actionsRect || actionsRect.width < 40 || !controls.length) {
      failures.push(`${p} action group missing`);
      continue;
    }
    if (publishedRect && overlap(publishedRect, actionsRect)) {
      failures.push(`${p} PUBLICAT overlaps action group`);
    }
    for (const [index, control] of controls.entries()) {
      if (!control.label?.trim() || !control.title?.trim()) {
        failures.push(`${p} action ${index + 1} missing accessible name/title`);
      }
      const box = control.rect;
      if (!box || box.width < 30 || box.left < Math.max(rowRect.left, tableRect.left) - 1
          || box.right > Math.min(rowRect.right, tableRect.right, viewportWidth) + 1) {
        failures.push(`${p} action ${index + 1} clipped/off-screen`);
      }
    }
  }
  return {pass: failures.length === 0, failures, checkedRows: rows.length};
}
