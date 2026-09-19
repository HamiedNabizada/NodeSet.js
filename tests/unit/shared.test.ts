// Cases shared with the AMLOpcUa plugin, which implements instantiation a
// second time in C#: for DI types and chosen Optional children, which children
// a new instance gets. Both test suites read tests/shared/instantiation.json,
// so the two implementations cannot drift apart unnoticed. UPDATE_SHARED=1
// writes the file from this implementation instead of checking it.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from '../../src/workspace';

const DI = 'http://opcfoundation.org/UA/DI/';
const FILE = join(__dirname, '..', 'shared', 'instantiation.json');

interface Case { type: string; optional: string[]; children: string[] }

async function children(type: string, optional: string[]): Promise<string[]> {
  const ws = new Workspace();
  await ws.create('http://example.org/Shared/');
  await ws.addBundled(DI);
  const t = ws.space.ofClass('ObjectType').find(n => n.browseName.name === type && n.id.startsWith(DI + '|'));
  if (!t) throw new Error(`DI has no ObjectType ${type}.`);
  const key = ws.editor!.instantiate(t.id, 'X', { optional: p => optional.includes(p), allowAbstract: true });
  const paths: string[] = [];
  const walk = (k: string, prefix: string) => {
    for (const c of ws.space.children(ws.space.get(k)!)) {
      paths.push(prefix + c.node.browseName.name);
      walk(c.node.id, `${prefix}${c.node.browseName.name}/`);
    }
  };
  walk(key, '');
  return paths.sort();
}

describe('Cases shared with AMLOpcUa', () => {
  const shared = JSON.parse(readFileSync(FILE, 'utf8')) as { model: string; cases: Case[] };

  if (process.env.UPDATE_SHARED === '1') {
    it('writes the cases', async () => {
      for (const c of shared.cases) c.children = await children(c.type, c.optional);
      writeFileSync(FILE, JSON.stringify(shared, null, 2) + '\n');
    });
    return;
  }

  it.each(shared.cases.map(c => [c.type, c.optional.join(',') || '-', c] as const))('%s with %s', async (_t, _o, c) => {
    expect(await children(c.type, c.optional)).toEqual([...c.children].sort());
  });
});
