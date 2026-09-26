import { Finding } from '../../src/nodeset/checks';
import { runChecks } from '../../src/ui/findings';

describe('Running the checks for the list of findings', () => {
  it('hands on what the checks found', () => {
    const found: Finding[] = [{ rule: 'M003', severity: 'error', node: 'x|i=1', message: 'it has no TypeDefinition.' }];
    expect(runChecks(() => found)).toEqual({ findings: found });
  });

  it('says that the checks stopped instead of taking the modeler with them', () => {
    const checked = runChecks(() => { throw new Error('no supertype chain'); });
    expect(checked).toEqual({ findings: [], error: 'The checks stopped: no supertype chain' });
  });
});
