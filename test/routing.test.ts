import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/env';

describe('canonical host', () => {
  it('redirects www to the main domain, keeping the path and query', async () => {
    const res = await worker.fetch(new Request('https://www.speconeautolabs.co.uk/book?package=dpf-regeneration'), {} as Env, {} as ExecutionContext);
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://speconeautolabs.co.uk/book?package=dpf-regeneration');
  });
});
