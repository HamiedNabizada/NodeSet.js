// Unsaved work kept in the browser, for the modeler on a page of its own: a
// crashed tab, a closed window or a reload keeps what was not saved, and the
// next start offers it. Inside a host such as the AMLOpcUa plugin there is no
// backup; the host keeps the model.
//
// One draft per page, written once editing pauses and removed once nothing is
// unsaved. A page offers the drafts of other pages, never its own. Up to the
// pause, the last changes are only in the page: closing it within that time
// loses them, which is why the page still asks before it is closed.

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
  /** Told once when the browser refuses to keep a draft. */
  onFailure?: (message: string) => void;
}

export class Backup {
  /** This page; its draft is never offered to itself. */
  readonly id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private timer?: ReturnType<typeof setTimeout>;
  private failed = false;

  constructor(private readonly store: DraftStore, private readonly options: Options = {}) {}

  /**
   * Keeps the model once editing pauses. `model` is asked then, not now, so
   * the model is written once per pause; undefined means nothing is unsaved.
   */
  keep(model: () => Omit<Draft, 'id' | 'savedAt'> | undefined): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      let draft: Omit<Draft, 'id' | 'savedAt'> | undefined;
      try {
        draft = model();
      } catch (e) {
        this.fail(e);
        return;
      }
      const done = draft ? this.store.put({ ...draft, id: this.id, savedAt: Date.now() }) : this.store.remove(this.id);
      done.catch(e => this.fail(e));
    }, this.options.delay ?? 1500);
  }

  /** The drafts of other pages, newest first. */
  async offered(): Promise<Draft[]> {
    const drafts = await this.store.list();
    return drafts.filter(d => d.id !== this.id).sort((a, b) => b.savedAt - a.savedAt);
  }

  /** Removes a draft that was restored or discarded. */
  forget(id: string): Promise<void> {
    return this.store.remove(id);
  }

  private fail(e: unknown): void {
    if (this.failed) return;
    this.failed = true;
    this.options.onFailure?.(`The browser keeps no backup of the model: ${e instanceof Error ? e.message : String(e)}`);
  }
}
