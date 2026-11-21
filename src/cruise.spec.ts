import { normalizeCycle, readCruise } from './cruise.js';

const SRC = 'packages/apps/main/src';

describe('readCruise', () => {
  const scan = readCruise(
    {
      modules: [
        {
          source: `${SRC}/a.ts`,
          dependencies: [
            { module: '@/b', resolved: `${SRC}/b.ts`, couldNotResolve: false },
            {
              module: '@helu/hds',
              resolved: 'packages/libs/hds/src/main.ts',
              couldNotResolve: false,
            },
            {
              module: './en/a.json',
              resolved: `${SRC}/en/a.json`,
              couldNotResolve: false,
            },
            { module: 'vue', resolved: 'vue', couldNotResolve: true },
            { module: '@/gone', resolved: '@/gone', couldNotResolve: true },
          ],
        },
      ],
      summary: {
        violations: [
          {
            rule: { name: 'no-circular' },
            from: `${SRC}/b.ts`,
            cycle: [{ name: `${SRC}/a.ts` }, { name: `${SRC}/b.ts` }],
          },
          {
            rule: { name: 'no-circular' },
            from: `${SRC}/a.ts`,
            cycle: [{ name: `${SRC}/b.ts` }, { name: `${SRC}/a.ts` }],
          },
          { rule: { name: 'no-orphans' }, from: `${SRC}/c.ts` },
        ],
      },
    },
    {
      srcDir: SRC,
      libraryOf: (dependency) => (dependency.module.startsWith('@helu/') ? dependency.module : null),
      isLocal: (specifier) => specifier.startsWith('@/') || specifier.startsWith('.'),
    }
  );

  it('keeps code imports inside the app and libraries apart, and drops JSON and packages', () => {
    const entry = scan.byFile.get(`${SRC}/a.ts`);
    expect(entry?.imports).toEqual([`${SRC}/b.ts`]);
    expect(entry?.libraries).toEqual(['@helu/hds']);
    expect(entry?.unresolved).toEqual(['@/gone']);
  });

  it('lists each import cycle once, whichever file dependency-cruiser reported it from', () => {
    expect(scan.cycles).toEqual([[`${SRC}/a.ts`, `${SRC}/b.ts`]]);
  });
});

describe('normalizeCycle', () => {
  it('starts a cycle at its smallest file id', () => {
    expect(normalizeCycle(['c', 'a', 'b'])).toEqual(['a', 'b', 'c']);
  });
});
