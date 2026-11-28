import { compendiumImportV3Schema, type CompendiumImportV3Input, type CompendiumImportItemV3Input } from './importV3Schemas';
import { compendiumImportV2Schema, type CompendiumImportV2Input } from './importV2Schemas';
import { IMPORT_TEMPLATE_VERSION_V2 } from './importVersions';
import { analyzeCompendiumImportV2Semantics, type ImportSemanticValidationOptions } from './importSemanticValidation';

export interface V3StagingIssue {
  severity:'error'|'warning';
  code:string;
  message:string;
  itemId?:string;
}
type Source = CompendiumImportV3Input['source'];
const projectSource = (source:Source) => ({
  ...source,
  rulesEra: source.rulesEra === '2014' ? 'legacy' : source.rulesEra === '2024' ? '2024' : undefined,
  // Staging never promotes active or unknown-edition content.
  status: source.status === 'disabled' ? 'disabled' : 'needsReview'
});
/** Compatibility probe only. Not an import or storage boundary. */
export const projectV3ToV2ForValidation = (pack:CompendiumImportV3Input):CompendiumImportV2Input =>
  compendiumImportV2Schema.parse({
    templateVersion:IMPORT_TEMPLATE_VERSION_V2,
    id:pack.id,
    source:projectSource(pack.source),
    metadata:{...pack.metadata,v3:{contractRevision:pack.contractRevision,source:pack.source}},
    items:pack.items.map(({identity,precedence,provenance,source,metadata,...item}) => ({
      ...item,source:projectSource(source),
      metadata:{...metadata,v3:{identity,precedence,provenance,source}}
    }))
  });

export const validateV3Precedence = (pack:CompendiumImportV3Input):V3StagingIssue[] => {
  const issues:V3StagingIssue[] = [];
  const byId = new Map<string,CompendiumImportItemV3Input>();
  const add = (severity:V3StagingIssue['severity'],code:string,message:string,itemId?:string) =>
    issues.push({severity,code,message,itemId});
  for (const item of pack.items) {
    if (byId.has(item.id)) add('error','V3_DUPLICATE_ID','Duplicate physical ID',item.id);
    else byId.set(item.id,item);
    if (item.identity.precedenceScope !== item.source.precedenceScope)
      add('error','V3_SCOPE_MISMATCH','Identity scope differs from source scope',item.id);
    if (item.source.rulesEra === 'unknown')
      add('warning','V3_UNKNOWN_ERA','Edition must be classified before activation',item.id);
  }
  const edges = new Map<string,string[]>();
  for (const item of pack.items) {
    const seen = new Set<string>();
    const p = item.precedence;
    const groups = [['supersedes',p.supersedes],['reprints',p.reprints],['coexists',p.coexistsWith]] as const;
    if (p.relation === 'original' && groups.some(([,ids]) => ids.length))
      add('error','V3_ORIGINAL_HAS_RELATIONS','Original relation cannot declare precedence targets',item.id);
    if ((p.relation === 'supersedes' && !p.supersedes.length) ||
        (p.relation === 'reprint' && !p.reprints.length) ||
        (p.relation === 'coexists' && !p.coexistsWith.length))
      add('error','V3_RELATION_MISSING_TARGET','Declared relation requires a target',item.id);
    if (p.relation === 'unresolved')
      add('warning','V3_UNRESOLVED_PRECEDENCE','Precedence requires editorial review',item.id);
    for (const [relation,ids] of groups) for (const id of ids) {
      if (id === item.id) add('error','V3_SELF_RELATION','Self-referential precedence',item.id);
      if (seen.has(id)) add('error','V3_DUPLICATE_TARGET','Target repeated across relations: '+id,item.id);
      seen.add(id);
      const target = byId.get(id);
      if (!target) {
        add('warning','V3_EXTERNAL_PRECEDENCE','Target needs cross-pack resolution: '+id,item.id);
        continue;
      }
      if (relation !== 'coexists' && (item.kind !== target.kind ||
        item.identity.canonicalKey !== target.identity.canonicalKey ||
        item.identity.precedenceScope !== target.identity.precedenceScope))
        add('error','V3_INCOMPATIBLE_PRECEDENCE','Target kind, canonical key or scope differs: '+id,item.id);
      if (relation === 'supersedes') {
        if (item.source.rulesEra === 'unknown' || item.source.rulesEra !== target.source.rulesEra)
          add('error','V3_CROSS_ERA_SUPERSEDES','Supersedes requires same known rules era',item.id);
        const a = item.source.publication, b = target.source.publication;
        if (a.precision === 'day' && b.precision === 'day' && a.date < b.date ||
            a.year !== null && b.year !== null && a.year < b.year)
          add('error','V3_OLDER_SUPERSEDES_NEWER','Older publication cannot supersede newer target',item.id);
        edges.set(item.id,[...(edges.get(item.id) || []),id]);
      }
    }
  }
  // Kahn traversal detects cycles without recursion on large packs.
  const indegree = new Map([...byId.keys()].map(id => [id,0]));
  for (const targets of edges.values()) for (const id of targets) indegree.set(id,(indegree.get(id) ?? 0)+1);
  const queue = [...indegree].filter(([,n]) => n===0).map(([id]) => id);
  for (let i=0;i<queue.length;i++) for (const id of edges.get(queue[i]) || []) {
    const n = (indegree.get(id) ?? 0)-1; indegree.set(id,n);
    if (n===0) queue.push(id);
  }
  if (queue.length !== byId.size) add('error','V3_SUPERSEDES_CYCLE','Cycle in local supersedes graph');
  return issues;
};

const record = (value:unknown):Record<string,unknown>|undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : undefined;
const alternativeAccessKinds = new Set(['subclass','classVariant','feat','reward','background','optionalfeature','race']);

// An empty direct class list is legitimate for an upstream spell with explicit
// alternative grants. Admit it only as a non-active V3 review record. A label
// alone, unknown access group, or active/manual/legacy record cannot waive V2.
function reviewOnlyAlternativeSpellIds(pack:CompendiumImportV3Input):Set<string> {
  const ids = new Set<string>();
  if (pack.source.status !== 'needsReview' || pack.metadata?.activation !== 'review-required') return ids;
  for (const item of pack.items) {
    if (item.kind !== 'spell' || item.source.status !== 'needsReview' ||
        item.provenance.origin !== '5etools' || item.provenance.repository !== '5etools-mirror-3/5etools-src' ||
        item.payload.classes.length !== 0 || (item.payload.classIds?.length ?? 0) !== 0) continue;
    const notes = item.metadata?.reviewCodes;
    if (!Array.isArray(notes) || !notes.includes('alternativeSpellAccessPending')) continue;
    const upstream = record(item.payload.mechanics?.upstreamSpell), policy = record(upstream?.accessPolicy), access = record(upstream?.access);
    if (!upstream || !policy || !access ||
        policy.status !== 'alternativeGrantReviewPending' || policy.directClassAccess !== 'notObserved' ||
        !Array.isArray(upstream.selectedClassAccess) || upstream.selectedClassAccess.length !== 0 ||
        (access.class !== undefined && (!record(access.class) || Object.keys(record(access.class)!).length !== 0))) continue;
    const observed = Object.keys(access).filter(key => {
      const group = record(access[key]);
      return alternativeAccessKinds.has(key) && !!group && Object.values(group).some(value => {
        const bySource = record(value);
        return !!bySource && Object.keys(bySource).length > 0;
      });
    }).sort();
    const claimed = policy.alternativeKinds;
    if (!observed.length || !Array.isArray(claimed) || claimed.length !== observed.length ||
        !observed.every((kind,index) => claimed[index] === kind)) continue;
    ids.add(item.id);
  }
  return ids;
}

export function stageImportV3(input:unknown,options:ImportSemanticValidationOptions = {}) {
  let value = input;
  if (typeof input === 'string') {
    try { value = JSON.parse(input); }
    catch { return {ok:false as const,activation:'review-required' as const,issues:[{severity:'error',code:'V3_JSON_ERROR',message:'Invalid JSON'}]}; }
  }
  const parsed = compendiumImportV3Schema.safeParse(value);
  if (!parsed.success) return {
    ok:false as const,activation:'review-required' as const,
    issues:parsed.error.issues.map(issue => ({severity:'error',code:'V3_SCHEMA_ERROR',message:issue.path.join('.')+': '+issue.message}))
  };
  const precedenceIssues = validateV3Precedence(parsed.data);
  if (precedenceIssues.some(i => i.severity === 'error')) return {ok:false as const,activation:'review-required' as const,issues:precedenceIssues};
  const projection = projectV3ToV2ForValidation(parsed.data);
  const semantic = analyzeCompendiumImportV2Semantics(projection,options,reviewOnlyAlternativeSpellIds(parsed.data));
  return {ok:semantic.valid,activation:'review-required' as const,pack:parsed.data,
    projection,semantic,issues:[...precedenceIssues,...semantic.issues]};
}
