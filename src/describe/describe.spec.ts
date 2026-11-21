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
