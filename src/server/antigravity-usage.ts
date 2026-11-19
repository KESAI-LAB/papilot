// `agy --print /usage --output-format json` is a built-in command, not a
// model turn. Keep the CLI's group boundaries and explicit window labels.
// Verified against the CLI on 2026-11-19; see docs/antigravity-usage.md.
export function antigravityLimits(value: any) {
  if (value?.status !== 'SUCCESS' || value.command?.name !== 'usage' || !Array.isArray(value.command.data?.groups)) {
    throw new Error('Antigravity did not report structured usage.');
  }
  const windows = value.command.data.groups.flatMap((group: any) => {
    if (typeof group?.name !== 'string' || !group.name.trim() || !Array.isArray(group.buckets)) return [];
    return group.buckets.flatMap((bucket: any) => {
      const remaining = bucket?.remaining_fraction;
      // An absent fraction (or an amount without a denominator) is unknown,
      // not zero usage. Disabled buckets do not apply to this account.
      if (bucket?.disabled || typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0 || remaining > 1) return [];
      const minutes = bucket.window === '5h' ? 300 : bucket.window === 'weekly' ? 10080 : null;
      const reset = typeof bucket.reset_time === 'string' ? Date.parse(bucket.reset_time) : NaN;
      return [{ usedPercent: (1 - remaining) * 100, windowDurationMins: minutes,
        resetsAt: Number.isFinite(reset) ? reset / 1000 : null, scope: group.name,
        ...(minutes === null && typeof bucket.name === 'string' ? { label: bucket.name } : {}) }];
    });
  });
  // Exhaustion belongs to each model group, never to the whole account.
  return { rateLimits: { windows } };
}
