// A message of the core that an interface can translate: the English text,
// its template with {0}, {1} … for the values, and the values. Scripts read the
// English; the modeler's interface looks the template up in its language. A
// value can be a message itself ("Line 4: <why>"), translated along with it.

export type Argument = string | Message;

export class Message {
  constructor(readonly template: string, readonly args: readonly Argument[]) {}

  toString(): string {
    return fill(this.template, this.args.map(String));
  }
}

/** The template with its values put in. */
export function fill(template: string, args: readonly (string | number)[]): string {
  return template.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)] ?? ''));
}

/** A message written as a tagged template literal, the values in placeholders. */
export function msg(strings: TemplateStringsArray, ...values: unknown[]): Message {
  let template = strings[0];
  for (let i = 1; i < strings.length; i++) template += `{${i - 1}}` + strings[i];
  return new Message(template, values.map(v =>
    v instanceof Message ? v : v instanceof MessageError ? new Message(v.template, v.args) : String(v)));
}

/** An error whose text an interface can translate; its message is the English. */
export class MessageError extends Error {
  readonly template: string;
  readonly args: readonly Argument[];

  constructor(message: string | Message) {
    super(String(message));
    this.template = typeof message === 'string' ? message : message.template;
    this.args = typeof message === 'string' ? [] : message.args;
  }
}
