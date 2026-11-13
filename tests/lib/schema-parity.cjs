// Compare behavior and access rules, not just object names. Never normalize SQL tokens or literals.
const canon = (v) => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const normalize = m => ({ ...m,
  tables: Object.fromEntries(Object.entries(m.tables || {}).map(([k,v]) => [k,{...v,cols:[...v.cols].sort()}])),
  triggers: [...(m.triggers||[])].sort(), buckets:[...(m.buckets||[])].sort(), realtime:[...(m.realtime||[])].sort()
});
function differences(expected, actual) {
  const a=normalize(expected), b=normalize(actual), diffs=[];
  for(const part of new Set([...Object.keys(a),...Object.keys(b)])) {
    if (canon(a[part])===canon(b[part])) continue;
    if (a[part] && b[part] && !Array.isArray(a[part]) && !Array.isArray(b[part])) {
      for(const key of new Set([...Object.keys(a[part]),...Object.keys(b[part])]))
        if(canon(a[part][key])!==canon(b[part][key])) diffs.push(part+' '+key);
    } else diffs.push(part);
  }
  return diffs.sort();
}
module.exports={canon,normalize,differences};

