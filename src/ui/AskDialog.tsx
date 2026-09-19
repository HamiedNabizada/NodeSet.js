// A question for one line of text, instead of window.prompt: it follows the
// theme, can offer a list to choose from (the ReferenceTypes of the model),
// and says what is wrong without closing.

import { useEffect, useRef, useState } from 'react';

export interface Ask {
  title: string;
  value?: string;
  /** Values to choose from; others may be typed too. */
  options?: string[];
  /** Checks the answer; a message keeps the dialog open. */
  check?: (value: string) => string | undefined;
  onOk: (value: string) => void;
}

export function AskDialog({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  const [value, setValue] = useState(ask.value ?? '');
  const [problem, setProblem] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);

  const ok = () => {
    const text = value.trim();
    if (!text) { setProblem('Enter a name.'); return; }
    const message = ask.check?.(text);
    if (message) { setProblem(message); return; }
    onClose();
    ask.onOk(text);
  };

  return (
    <div className="ask-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ask" role="dialog" aria-modal="true" aria-labelledby="ask-title">
        <label id="ask-title" htmlFor="ask-input">{ask.title}</label>
        <input
          id="ask-input" ref={input} value={value} list={ask.options ? 'ask-options' : undefined}
          onChange={e => { setValue(e.target.value); setProblem(undefined); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); ok(); }
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
        />
        {ask.options && <datalist id="ask-options">{ask.options.map(o => <option key={o} value={o} />)}</datalist>}
        {problem && <div className="ask-problem" role="alert">{problem}</div>}
        <div className="ask-buttons">
          <button className="primary" onClick={ok}>OK</button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
