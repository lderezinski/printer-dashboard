// Copyright (C) 2026 Flashforge Health contributors
// SPDX-License-Identifier: AGPL-3.0-only
// Local preferences live in ignored data/security.json. Environment overrides are explicit.
export function securitySettings(value = {}, env = process.env) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid data/security.json.');
  const fields = { allowLanReadOnly: 'FLASHFORGE_LAN', allowInsecureMqtt: 'FLASHFORGE_ALLOW_INSECURE_MQTT' };
  if (Object.keys(value).some(key => !Object.hasOwn(fields, key))) throw new Error('Unknown option in data/security.json.');
  const result = {};
  for (const [key, variable] of Object.entries(fields)) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error(`Security setting ${key} must be true or false.`);
    if (env[variable] !== undefined && !['on', 'off'].includes(env[variable])) throw new Error(`${variable} must be on or off.`);
    result[key] = env[variable] === undefined ? value[key] === true : env[variable] === 'on';
  }
  return result;
}

export function viewerMaintenance(status, localTools) {
  if (localTools || !status.baseline) return status;
  const { serialNumber, ...baseline } = status.baseline;
  return { ...status, baseline };
}
