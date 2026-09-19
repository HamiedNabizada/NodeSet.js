// The link to an application that embeds the modeler, such as the AMLOpcUa
// plugin of the AutomationML Editor through WebView2. Without a host the
// modeler runs on its own and this does nothing.
//
// The host sends a NodeSet to edit, with the NodeSets it requires, or asks for
// a new model; the modeler answers "ready" once it listens, and sends the
// NodeSet back when the user applies it. "theme" tells the modeler whether the
// host is light or dark.

export type HostToModeler =
  | { type: 'open'; name: string; xml: string; required?: string[] }
  | { type: 'new'; modelUri: string; required?: string[] }
  | { type: 'theme'; dark: boolean };

export type ModelerToHost =
  | { type: 'ready'; version: string }
  | { type: 'apply'; xml: string; modelUri: string }
  | { type: 'dirty'; dirty: boolean }
  | { type: 'status'; text: string; warn?: boolean };

interface WebView {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
}

export class HostBridge {
  private constructor(private readonly webview: WebView) {}

  /** The host, when the page runs inside WebView2; undefined in a plain browser. */
  static detect(): HostBridge | undefined {
    const webview = (window as unknown as { chrome?: { webview?: WebView } }).chrome?.webview;
    return webview ? new HostBridge(webview) : undefined;
  }

  post(message: ModelerToHost): void {
    this.webview.postMessage(message);
  }

  /** Listens for host messages; returns the function that stops listening. */
  listen(handler: (message: HostToModeler) => void): () => void {
    const listener = (e: { data: unknown }) => {
      const data = typeof e.data === 'string' ? safeParse(e.data) : e.data;
      if (data && typeof data === 'object' && 'type' in data) handler(data as HostToModeler);
    };
    this.webview.addEventListener('message', listener);
    return () => this.webview.removeEventListener('message', listener);
  }
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return undefined; }
}

/** Light or dark chrome; without a call the page follows the system. */
export function applyTheme(dark: boolean): void {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
