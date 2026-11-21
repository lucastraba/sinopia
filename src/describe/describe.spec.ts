import { chunkBySize } from './describe.js';

describe('chunkBySize', () => {
  it('fills each chunk up to the limit and keeps the order', () => {
    expect(chunkBySize([40, 50, 30, 90, 10], (size) => size, 100)).toEqual([
      [40, 50],
      [30],
      [90, 10],
    ]);
  });

  it('puts an item larger than the limit in a chunk of its own', () => {
    expect(chunkBySize([10, 500, 10], (size) => size, 100)).toEqual([
      [10],
      [500],
      [10],
    ]);
  });
});

describe('cache keys and adapter links', () => {
  const file = {
    id: 'hub/counter.ts', part: 'hub', kind: 'other' as const, lines: 3, hash: 'abc',
    imports: [], libraries: [], components: [], operations: [], flags: [], registeredAs: null,
  };

  it('keeps the key of a file without links, and changes it when links arrive', async () => {
    const { fileKey } = await import('./describe.js');
    const plain = fileKey(file);
    expect(fileKey({ ...file, links: [] })).toBe(plain);
    const linked = fileKey({ ...file, links: [{ target: 'server/counter.ts', kind: 'trpc', label: 'counters.increment' }] });
    expect(linked).not.toBe(plain);
    expect(
      fileKey({ ...file, links: [{ target: 'server/counter.ts', kind: 'trpc', label: 'counters.increment' }] })
    ).toBe(linked);
  });
});
