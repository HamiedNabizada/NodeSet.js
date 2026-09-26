import { Backup, Draft, DraftStore, memoryStore } from '../../src/ui/backup';

const model = (xml: string) => () => ({ title: 'http://example.org/Pumps/', xml, required: ['<UANodeSet/>'] });
const kept = (id: string, savedAt: number, title: string): Draft => ({ id, savedAt, title, xml: '<UANodeSet/>', required: [] });

describe('The backup of unsaved work', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps the model once editing pauses, in the state it has then', async () => {
    const store = memoryStore();
    const backup = new Backup(store, { delay: 1000 });
    backup.keep(model('<first/>'));
    await vi.advanceTimersByTimeAsync(500);
    backup.keep(model('<second/>'));
    expect(await store.list()).toEqual([]);

    await vi.advanceTimersByTimeAsync(1000);
    const drafts = await store.list();
    expect(drafts.map(d => [d.id, d.xml, d.required])).toEqual([[backup.id, '<second/>', ['<UANodeSet/>']]]);
  });

  it('forgets the model once nothing is unsaved', async () => {
    const store = memoryStore();
    const backup = new Backup(store, { delay: 1000 });
    backup.keep(model('<first/>'));
    await vi.advanceTimersByTimeAsync(1000);

    backup.keep(() => undefined);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await store.list()).toEqual([]);
  });

  it('offers what other pages kept, newest first, never its own', async () => {
    const store = memoryStore();
    await store.put(kept('a', 1, 'Old'));
    await store.put(kept('b', 2, 'New'));
    const backup = new Backup(store, { delay: 1000 });
    backup.keep(model('<mine/>'));
    await vi.advanceTimersByTimeAsync(1000);

    expect((await backup.offered()).map(d => d.title)).toEqual(['New', 'Old']);
    await backup.forget('b');
    expect((await backup.offered()).map(d => d.title)).toEqual(['Old']);
  });

  it('forgets the model at once when it is saved, and drops a write still waiting', async () => {
    const store = memoryStore();
    const backup = new Backup(store, { delay: 1000 });
    backup.keep(model('<first/>'));
    await vi.advanceTimersByTimeAsync(1000);
    backup.keep(model('<second/>'));

    await backup.clear();
    expect(await store.list()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await store.list()).toEqual([]);
  });

  it('writes a waiting draft at once when asked, as when the page goes away', async () => {
    const store = memoryStore();
    const backup = new Backup(store, { delay: 1000 });
    backup.keep(model('<first/>'));

    await backup.flush();
    expect((await store.list()).map(d => d.xml)).toEqual(['<first/>']);
  });

  it('takes a restored draft over as its own, so there is always one copy', async () => {
    const store = memoryStore();
    await store.put(kept('a', 1, 'Restored'));
    const backup = new Backup(store, { delay: 1000 });

    await backup.adopt(kept('a', 1, 'Restored'));
    expect((await store.list()).map(d => [d.id, d.title])).toEqual([[backup.id, 'Restored']]);
  });

  it('does not offer the drafts of pages that are still open', async () => {
    const store = memoryStore();
    await store.put(kept('open', 2, 'Open elsewhere'));
    await store.put(kept('closed', 1, 'Left behind'));
    const backup = new Backup(store, { delay: 1000, live: async () => new Set(['open']) });

    expect((await backup.offered()).map(d => d.title)).toEqual(['Left behind']);
  });

  it('reports a store that cannot be read or cleared, and goes on', async () => {
    const broken: DraftStore = {
      list: () => Promise.reject(new Error('read failed')),
      put: () => Promise.resolve(),
      remove: () => Promise.reject(new Error('remove failed')),
    };
    const failures: string[] = [];
    const backup = new Backup(broken, { delay: 1000, onFailure: message => failures.push(message) });

    expect(await backup.offered()).toEqual([]);
    await backup.forget('a');
    expect(failures).toEqual(['The browser keeps no backup of the model: read failed']);
  });

  it('says so when the browser refuses to keep anything, and goes on', async () => {
    const refusing: DraftStore = { ...memoryStore(), put: () => Promise.reject(new Error('QuotaExceededError')) };
    const failures: string[] = [];
    const backup = new Backup(refusing, { delay: 1000, onFailure: message => failures.push(message) });
    backup.keep(model('<first/>'));
    await vi.advanceTimersByTimeAsync(1000);

    expect(failures).toEqual(['The browser keeps no backup of the model: QuotaExceededError']);
  });
});
