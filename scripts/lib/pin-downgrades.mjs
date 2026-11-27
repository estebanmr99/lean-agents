// Release gate helper (#590): compare core/pins.json against the previous release's copy. Pure: both parsed files are passed in.
import { compareAppVersions } from './update-plan.mjs';

// Returns { errors, notices } as `::error::` / `::notice::` lines. A downgrade needs a `downgrade` string on the new pin; pins missing from `oldPins` are new and fine.
export function pinDowngrades(oldPins, newPins) {
  const errors = [];
  const notices = [];
  for (const [key, now] of Object.entries(newPins ?? {})) {
    const before = oldPins?.[key]?.version;
    if (before === undefined || now?.version === undefined || compareAppVersions(now.version, before) >= 0) continue;
    if (typeof now.downgrade === 'string' && now.downgrade) notices.push(`::notice::pin downgrade: ${key} ${before} -> ${now.version} (${now.downgrade})`);
    else errors.push(`::error::pin downgrade: ${key} ${before} -> ${now.version}`);
  }
  return { errors, notices };
}
