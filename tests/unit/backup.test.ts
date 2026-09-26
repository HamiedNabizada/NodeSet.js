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

  it('says so when the browser refuses to keep anything, and goes on', async () => {
    const refusing: DraftStore = { ...memoryStore(), put: () => Promise.reject(new Error('QuotaExceededError')) };
    const failures: string[] = [];
    const backup = new Backup(refusing, { delay: 1000, onFailure: message => failures.push(message) });
    backup.keep(model('<first/>'));
    await vi.advanceTimersByTimeAsync(1000);

    expect(failures).toEqual(['The browser keeps no backup of the model: QuotaExceededError']);
  });
});
