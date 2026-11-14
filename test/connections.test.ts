import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { invalidateConnections, rawEnv, sealValue, storedConnections, withConnections } from '../src/lib/connections';
import { splitRow } from '../src/routes/ops';

const fakeDb = (rows: { name: string; value: string }[]) => ({ prepare: () => ({ all: async () => ({ results: rows }) }) }) as unknown as D1Database;

describe('connections centre', () => {
  it('encrypts keys and merges them into the environment', async () => {
    const env = { SETUP_TOKEN: 'owner-secret', DB: fakeDb([]) } as unknown as Env;
    const sealed = await sealValue(env, 'dvla-key-123');
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain('dvla-key-123');
    invalidateConnections();
    const merged = await withConnections({ ...env, DB: fakeDb([{ name: 'DVLA_API_KEY', value: sealed }]) } as unknown as Env);
    expect(merged.DVLA_API_KEY).toBe('dvla-key-123');
    expect(rawEnv(merged).DVLA_API_KEY).toBeUndefined();
  });
  it('lets a Cloudflare secret take priority', async () => {
    const env = { SETUP_TOKEN: 'owner-secret', DVLA_API_KEY: 'from-cloudflare' } as unknown as Env;
    const sealed = await sealValue(env, 'from-admin');
    invalidateConnections();
    const merged = await withConnections({ ...env, DB: fakeDb([{ name: 'DVLA_API_KEY', value: sealed }]) } as unknown as Env);
    expect(merged.DVLA_API_KEY).toBe('from-cloudflare');
  });
  it('flags keys that can no longer be decrypted and ignores unknown names', async () => {
    const sealed = await sealValue({ SETUP_TOKEN: 'old-token' } as unknown as Env, 'abc');
    invalidateConnections();
    const r = await storedConnections({ SETUP_TOKEN: 'new-token', DB: fakeDb([{ name: 'NTFY_TOPIC', value: sealed }, { name: 'EVIL', value: sealed }]) } as unknown as Env);
    expect(r.values).toEqual({});
    expect(r.unreadable).toEqual(['NTFY_TOPIC']);
  });
  it('refuses to store keys without a setup token in production', async () => {
    await expect(sealValue({} as Env, 'x')).rejects.toThrow(/SETUP_TOKEN/);
  });
});

describe('fault-code import parser', () => {
  it('splits CSV with quotes and tab-separated rows', () => {
    expect(splitRow('P0128, "Coolant thermostat, below temp", Cooling, "Stuck ""open"" thermostat"')).toEqual(['P0128', 'Coolant thermostat, below temp', 'Cooling', 'Stuck "open" thermostat']);
    expect(splitRow('U0100\tLost communication with ECM\tNetwork')).toEqual(['U0100', 'Lost communication with ECM', 'Network']);
  });
});
