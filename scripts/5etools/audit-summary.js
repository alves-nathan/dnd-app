'use strict';
// CI-safe summary: no raw entities, diagnostics, third-party titles or upstream payloads.
const { openSnapshot } = require('./inventory');
const { audit } = require('./resolver');
function summarize(report) {
  const totals = {total:0,resolvedSubset:0,blocked:0};
  for (const c of Object.values(report.counts)) for (const key of Object.keys(totals)) totals[key] += c[key];
  const pilot = {};
  for (const key of ['main:PHB','main:XPHB','main:XDMG','main:XMM','main:EFA','main:TCE','main:AAG','main:BAM','main:LoX','main:AU','main:WoW']) {
    const c = report.bySource[key];
    if (c) pilot[key] = {total:c.total,resolvedSubset:c.resolvedSubset,blocked:c.blocked,variants:c.variants,reprints:c.reprints};
  }
  return {schemaVersion:'dnd-upstream-resolution-summary.v1',commits:report.commits,totals,
    sources:Object.keys(report.bySource).length,counts:report.counts,issueCounts:report.issueCounts,pilot,
    scope:report.scope,activation:'review-required'};
}
module.exports = {summarize};
if (require.main === module) {
  try {
    const [main,brew] = process.argv.slice(2);
    if (!main || !brew) throw new Error('missing paths');
    const summary = summarize(audit(openSnapshot(main),openSnapshot(brew)));
    console.log(JSON.stringify(summary,null,2));
    // Blocked entities are expected at this stage; file failures are infrastructure errors.
    if (summary.issueCounts.unreadableFile) process.exitCode = 2;
  } catch { console.error('Upstream audit failed; inspect local snapshots offline.'); process.exitCode = 1; }
}
