import { compileTemplate, matchAll } from './template.js';

const keys = (template: string | RegExp, text: string) =>
  compileTemplate(template)
    .match(text)
    .map((m) => m.values.key?.value);

describe('compileTemplate', () => {
  it('captures an identifier or a string literal as {key}', () => {
    expect(keys('ee.emit({key}', 'ee.emit(COUNTER_UPDATE, 1)')).toEqual(['COUNTER_UPDATE']);
    expect(keys('ee.emit({key}', `ee.emit('counter.update')`)).toEqual(['counter.update']);
    expect(keys('ee.emit({key}', 'ee.emit("a:b")')).toEqual(['a:b']);
    expect(compileTemplate('ee.emit({key}').match(`ee.emit('x')`)[0]?.values.key).toEqual({ value: 'x', quoted: true });
  });

  it('allows whitespace between the parts of the code', () => {
    expect(keys('ee.emit({key}', 'ee .emit (\n  FOO)')).toEqual(['FOO']);
    expect(keys('on(ee, {key}', 'on( ee ,BAR)')).toEqual(['BAR']);
  });

  it('matches whole words at both ends and whole keys', () => {
    expect(keys('ee.emit({key}', 'free.emit(FOO)')).toEqual([]);
    expect(compileTemplate('ee.emit').match('ee.emitter')).toHaveLength(0);
    expect(keys('send({key})', 'send(counter.increment)')).toEqual([]);
    expect(keys('send({key})', 'send(increment)')).toEqual(['increment']);
  });

  it('needs at least one space where the template has one between two words', () => {
    expect(compileTemplate('export const {key}').match('export const FOO = 1')).toHaveLength(1);
    expect(compileTemplate('export const {key}').match('exportconst FOO')).toHaveLength(0);
  });

  it('skips anything on the line with {*}', () => {
    const m = compileTemplate('bus.publish({*}, {key})').match(`bus.publish(ctx.user, 'order.paid')`);
    expect(m[0]?.values.key?.value).toBe('order.paid');
  });

  it('captures several named values', () => {
    const [m] = compileTemplate('req.url === {path} && req.method === {method}').match(
      `if (req.url === '/control/voice' && req.method === 'GET') {`
    );
    expect(m?.values.path?.value).toBe('/control/voice');
    expect(m?.values.method?.value).toBe('GET');
  });

  it('takes a RegExp, with named groups as values, and says it is raw', () => {
    const t = compileTemplate(/emit\((?<key>[A-Z_]+)\)/);
    expect(t.raw).toBe(true);
    expect(t.match('emit(FOO) emit(BAR)').map((m) => m.values.key?.value)).toEqual(['FOO', 'BAR']);
  });

  it('refuses an empty template and a name used twice', () => {
    expect(() => compileTemplate('  ')).toThrow(/Empty/);
    expect(() => compileTemplate('f({key}, {key})')).toThrow(/twice/);
  });
});

describe('matchAll', () => {
  it('lets a longer shape listed first win where two match the same code', () => {
    const templates = ['req.url === {path} && req.method === {method}', 'req.url === {path}'].map((t) => compileTemplate(t));
    const text = `if (req.url === '/a' && req.method === 'POST') {}\nif (req.url === '/health') {}`;
    expect(matchAll(templates, text).map((m) => [m.values.path?.value, m.values.method?.value ?? null])).toEqual([
      ['/a', 'POST'],
      ['/health', null],
    ]);
  });
});
