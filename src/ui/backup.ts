// Unsaved work kept in the browser, for the modeler on a page of its own: a
// crashed tab, a closed window or a reload keeps what was not saved, and the
// next start offers it. Inside a host such as the AMLOpcUa plugin there is no
// backup; the host keeps the model.
//
// One draft per page, written once editing pauses and removed as soon as
// nothing is unsaved. A page offers the drafts of pages that are gone, never
// its own and never one of a page still open: each page holds a lock under its
// id (Web Locks) for as long as it lives. A page that goes away writes a draft
// still waiting at once, as far as the browser lets it finish.

export interface Draft {
  /** The page that kept it. */
  id: string;
  savedAt: number;
  /** What the model is called in the offer: its namespace. */
  title: string;
  /** The model as a NodeSet. */
  xml: string;
  /** The NodeSet files it required that the modeler does not ship. */
  required: string[];
}

export interface DraftStore {
  list(): Promise<Draft[]>;
  put(draft: Draft): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Drafts in memory, gone with the page; for tests. */
export function memoryStore(): DraftStore {
  const drafts = new Map<string, Draft>();
  return {
    list: async () => [...drafts.values()],
    put: async draft => { drafts.set(draft.id, draft); },
    remove: async id => { drafts.delete(id); },
  };
}

/** Drafts in IndexedDB, which holds models of several MB; none where the browser has no IndexedDB. */
export function browserStore(name = 'nodeset-js'): DraftStore | undefined {
  if (typeof indexedDB === 'undefined') return undefined;
  let database: Promise<IDBDatabase> | undefined;
  const open = () => database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
  const run = <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void) =>
    open().then(db => new Promise<T | undefined>((resolve, reject) => {
      const transaction = db.transaction('drafts', mode);
      const request = work(transaction.objectStore('drafts'));
      transaction.oncomplete = () => resolve(request ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('The browser did not store the draft.'));
    }));
  return {
    list: async () => (await run<Draft[]>('readonly', store => store.getAll())) ?? [],
    put: async draft => { await run('readwrite', store => { store.put(draft); }); },
    remove: async id => { await run('readwrite', store => { store.delete(id); }); },
  };
}

interface Options {
  /** How long editing pauses before the draft is written, in ms. */
  delay?: number;
  /** Told once when the browser refuses to keep, read or remove a draft. */
  onFailure?: (message: string) => void;
  /** The ids of the pages still open; Web Locks where the browser has them, else none known. */
  live?: () => Promise<Set<string>>;
}

type Model = Omit<Draft, 'id' | 'savedAt'>;

const LOCK = 'nodeset-js-draft:';

/** The pages that hold their lock, that is, are still open. */
async function openPages(): Promise<Set<string>> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) return new Set();
  const { held = [] } = await locks.query();
  return new Set(held.map(l => l.name ?? '').filter(n => n.startsWith(LOCK)).map(n => n.slice(LOCK.length)));
}

export class Backup {
  /** This page; its draft is never offered to itself. */
  readonly id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private timer?: ReturnType<typeof setTimeout>;
  private waiting?: () => Model | undefined;
  private failed = false;

  constructor(private readonly store: DraftStore, private readonly options: Options = {}) {
    // Held until the page is gone, so other pages know this draft is not left behind.
    if (typeof navigator !== 'undefined' && navigator.locks) {
      navigator.locks.request(LOCK + this.id, () => new Promise<void>(() => undefined)).catch(() => undefined);
    }
  }

  /**
   * Keeps the model once editing pauses. `model` is asked then, not now, so
   * the model is written once per pause.
   */
  keep(model: () => Model | undefined): void {
    clearTimeout(this.timer);
    this.waiting = model;
    this.timer = setTimeout(() => { this.flush(); }, this.options.delay ?? 1500);
  }

  /** Writes a draft still waiting now. */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    const model = this.waiting;
    this.waiting = undefined;
    if (!model) return;
    try {
      const draft = model();
      await (draft ? this.store.put({ ...draft, id: this.id, savedAt: Date.now() }) : this.store.remove(this.id));
    } catch (e) {
      this.fail(e);
    }
  }

  /** Nothing is unsaved any more: the draft goes at once, and a write still waiting with it. */
  async clear(): Promise<void> {
    clearTimeout(this.timer);
    this.waiting = undefined;
    await this.guard(this.store.remove(this.id), undefined);
  }

  /** A draft this page restored becomes its own, so a copy exists at every moment. */
  async adopt(draft: Draft): Promise<void> {
    await this.guard(this.store.put({ ...draft, id: this.id, savedAt: Date.now() }), undefined);
    if (draft.id !== this.id) await this.forget(draft.id);
  }

  /** The drafts of pages that are gone, newest first. */
  async offered(): Promise<Draft[]> {
    const [drafts, live] = await Promise.all([
      this.guard(this.store.list(), [] as Draft[]),
      (this.options.live ?? openPages)().catch(() => new Set<string>()),
    ]);
    return drafts.filter(d => d.id !== this.id && !live.has(d.id)).sort((a, b) => b.savedAt - a.savedAt);
  }

  /** Removes a draft that was restored or discarded. */
  async forget(id: string): Promise<void> {
    await this.guard(this.store.remove(id), undefined);
  }

  /** The answer of the store, or the fallback once the failure is reported. */
  private async guard<T>(work: Promise<T>, fallback: T): Promise<T> {
    try {
      return await work;
    } catch (e) {
      this.fail(e);
      return fallback;
    }
  }

  private fail(e: unknown): void {
    if (this.failed) return;
    this.failed = true;
    this.options.onFailure?.(`The browser keeps no backup of the model: ${e instanceof Error ? e.message : String(e)}`);
  }
}
