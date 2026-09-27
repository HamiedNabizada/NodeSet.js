// The interface in English or in German, following the language of the
// browser; inside the AutomationML Editor plugin that is the language of
// Windows, which WebView2 takes on. The English text is the key; a text
// without a German entry stays English, and a test sees to it that none is
// without one.

import { Argument, fill } from '../nodeset/message';
import { de } from './de';

export type Language = 'en' | 'de';

function detect(): Language {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const first = nav?.languages?.[0] ?? nav?.language ?? '';
  return first.toLowerCase().startsWith('de') ? 'de' : 'en';
}

let language: Language = detect();

export function currentLanguage(): Language {
  return language;
}

/** For tests, and for a host that says which language it wants. */
export function setLanguage(value: Language): void {
  language = value;
}

/** A text of the interface in its language, with its values put in for {0}, {1} … */
export function t(text: string, ...args: (string | number)[]): string {
  return fill(language === 'de' ? de[text] ?? text : text, args);
}

/** A message of the core (an EditError, a finding) in the interface's language; its English when it has no template. */
export function translate(message: { template?: string; args?: readonly Argument[]; message?: string }): string {
  if (message.template === undefined) return message.message ?? '';
  return t(message.template, ...(message.args ?? []).map(a => (typeof a === 'string' ? a : translate(a))));
}
