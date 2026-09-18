import { existsSync, readFileSync } from 'node:fs';

const changed = process.argv.slice(2)
  .map((value) => value.trim())
  .filter(Boolean)
  .filter((path) => path.endsWith('.md'))
  .filter((path) => !path.startsWith('docs/archive/'));

let failed = false;

function annotate(level, file, message) {
  const safe = message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::${level} file=${file}::${safe}`);
}

for (const file of changed) {
  if (!existsSync(file)) continue;

  const content = readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/).length;
  const upper = content.slice(0, 1200).toUpperCase();

  if (upper.includes('STATUS: SUPERSEDED') || upper.includes('STATUS: HISTORICAL')) {
    continue;
  }

  const isRunbook = /runbook/i.test(file) || /^# .*runbook/im.test(content);

  if (isRunbook) {
    if (lines > 200) {
      annotate('error', file, `Runbook has ${lines} lines; hard limit is 200. Split the procedure or move reference/history out of the executable runbook.`);
      failed = true;
    } else if (lines > 150) {
      annotate('warning', file, `Runbook has ${lines} lines; target is <= 150. Review whether it can be split or linked to reference material.`);
    }

    const expected = ['Purpose', 'Preconditions', 'Steps', 'Verification', 'Rollback'];
    const missing = expected.filter((heading) => !new RegExp(`^#{1,4}\\s+${heading}\\b`, 'im').test(content));
    if (missing.length > 0) {
      annotate('warning', file, `Runbook preferred structure is incomplete; missing headings: ${missing.join(', ')}.`);
    }
  } else if (lines > 300) {
    annotate('warning', file, `Documentation file has ${lines} lines. Review for duplication, progressive disclosure, or split by purpose.`);
  }
}

if (failed) process.exit(1);
console.log(`Documentation policy check passed for ${changed.length} changed Markdown file(s).`);
