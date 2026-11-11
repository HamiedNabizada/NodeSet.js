import { savesAll } from '../../src/host/bridge';

describe('The replies of a host', () => {
  it('leave nothing unsaved only when they took the last change, or do not say which they took', () => {
    expect(savesAll({ ok: true, change: 7 }, 7)).toBe(true);
    expect(savesAll({ ok: true, change: 6 }, 7)).toBe(false);
    expect(savesAll({ ok: false, change: 7 }, 7)).toBe(false);
    // A host before 0.2.1 echoes nothing and is taken at its word.
    expect(savesAll({ ok: true }, 7)).toBe(true);
    expect(savesAll({ ok: false }, 7)).toBe(false);
  });
});
