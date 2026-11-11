// A question for one line of text, instead of window.prompt: it follows the
// theme, can offer a list to choose from (the ReferenceTypes of the model),
// and says what is wrong without closing.

import { useEffect, useRef, useState } from 'react';
import { t } from './i18n';

export interface Ask {
  title: string;
  value?: string;
  /** Values to choose from; others may be typed too. */
  options?: string[];
  /** Checks the answer; a message keeps the dialog open. */
  check?: (value: string) => string | undefined;
  /** A second line to answer, such as the supertype of a new type. */
  extra?: { label: string; value?: string; options?: string[]; check?: (value: string) => string | undefined };
  onOk: (value: string, extra?: string) => void;
}

export function AskDialog({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  const [value, setValue] = useState(ask.value ?? '');
  const [extra, setExtra] = useState(ask.extra?.value ?? '');
  const [problem, setProblem] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);

  const ok = () => {
    const text = value.trim();
    if (!text) { setProblem(t('Enter a name.')); return; }
    const message = ask.check?.(text) ?? (ask.extra ? ask.extra.check?.(extra.trim()) : undefined);
    if (message) { setProblem(message); return; }
    onClose();
    ask.onOk(text, ask.extra ? extra.trim() : undefined);
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); ok(); }
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div className="ask-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ask" role="dialog" aria-modal="true" aria-labelledby="ask-title">
        <label id="ask-title" htmlFor="ask-input">{ask.title}</label>
        <input
          id="ask-input" ref={input} value={value} list={ask.options ? 'ask-options' : undefined}
          onChange={e => { setValue(e.target.value); setProblem(undefined); }}
          onKeyDown={keys}
        />
        {ask.options && <datalist id="ask-options">{ask.options.map(o => <option key={o} value={o} />)}</datalist>}
        {ask.extra && (
          <>
            <label htmlFor="ask-extra">{ask.extra.label}</label>
            <input id="ask-extra" value={extra} list={ask.extra.options ? 'ask-extra-options' : undefined}
              onChange={e => { setExtra(e.target.value); setProblem(undefined); }} onKeyDown={keys} />
            {ask.extra.options && <datalist id="ask-extra-options">{ask.extra.options.map(o => <option key={o} value={o} />)}</datalist>}
          </>
        )}
        {problem && <div className="ask-problem" role="alert">{problem}</div>}
        <div className="ask-buttons">
          <button className="primary" onClick={ok}>OK</button>
          <button onClick={onClose}>{t('Cancel')}</button>
        </div>
      </div>
    </div>
  );
}
