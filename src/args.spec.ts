import { splitCommandArgs } from './args.js';

describe('splitCommandArgs', () => {
  it('never takes an option value for the repo', () => {
    expect(splitCommandArgs(['--base', 'main~3'])).toMatchObject({ repo: null, passOn: ['--base', 'main~3'] });
    expect(splitCommandArgs(['../app', '--head', 'feature', '--json'])).toMatchObject({
      repo: '../app',
      passOn: ['--head', 'feature', '--json'],
    });
    expect(splitCommandArgs(['--part', 'src/a', '--part', 'src/b', 'repo'])).toMatchObject({
      repo: 'repo',
      passOn: ['--part', 'src/a', '--part', 'src/b'],
    });
  });

  it("keeps sinopia's own options out of what runCli gets", () => {
    expect(splitCommandArgs(['repo', '--adapter', 'js', '--name=x', '--out', '/tmp/m', '--force'])).toEqual({
      repo: 'repo',
      adapter: 'js',
      name: 'x',
      out: '/tmp/m',
      passOn: ['--force'],
    });
  });
});
