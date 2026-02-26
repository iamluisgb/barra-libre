export function formatDate(d) {
  if (!d) return '—';
  const p = d.split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d;
}

export function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function mergeById(local, remote) {
  const map = new Map();
  for (const item of local) map.set(item.id, item);
  for (const item of remote) map.set(item.id, item);
  return [...map.values()];
}

export function mergeDB(local, remote) {
  const merged = { ...remote };
  merged.workouts = mergeById(local.workouts || [], remote.workouts || []);
  merged.bodyLogs = mergeById(local.bodyLogs || [], remote.bodyLogs || []);
  return merged;
}
