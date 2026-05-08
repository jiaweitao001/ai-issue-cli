const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { expandHome, resolveKbPath, loadManifest, verifySha256, kbErrors } = require('../lib/kb-resolver');
const { fixtureRoot, sampleKbDir, writeKbFixture, resetFixtureRoot } = require('./helpers/kb-fixture');

describe('kb-resolver', () => {
  beforeEach(() => {
    resetFixtureRoot();
  });

  afterAll(() => {
    resetFixtureRoot();
    writeKbFixture(sampleKbDir);
  });

  describe('expandHome', () => {
    it('expands home-prefixed paths and passes through other values', () => {
      expect(expandHome('~')).toBe(os.homedir());
      expect(expandHome('~/foo')).toBe(path.join(os.homedir(), 'foo'));
      expect(expandHome('/abs/foo')).toBe('/abs/foo');
      expect(expandHome('relative/foo')).toBe('relative/foo');
      expect(expandHome('')).toBe('');
    });

    it('resolves expanded paths and preserves empty values', () => {
      expect(resolveKbPath('')).toBe('');
      expect(resolveKbPath('~/foo')).toBe(path.resolve(os.homedir(), 'foo'));
      expect(resolveKbPath('relative/foo')).toBe(path.resolve('relative/foo'));
    });
  });

  describe('loadManifest', () => {
    it('loads a valid manifest', () => {
      const { kbDir, manifest } = writeKbFixture(path.join(fixtureRoot, 'valid'));
      expect(loadManifest(kbDir)).toMatchObject(manifest);
    });

    it('throws KB_CORRUPTED when manifest is missing', () => {
      const kbDir = path.join(fixtureRoot, 'missing');
      fs.mkdirSync(kbDir, { recursive: true });
      expect(() => loadManifest(kbDir)).toThrow(expect.objectContaining({
        code: kbErrors.KB_CORRUPTED,
        path: path.join(kbDir, 'manifest.json')
      }));
    });

    it('throws KB_CORRUPTED when manifest JSON is invalid', () => {
      const kbDir = path.join(fixtureRoot, 'bad-json');
      fs.mkdirSync(kbDir, { recursive: true });
      fs.writeFileSync(path.join(kbDir, 'manifest.json'), '{bad');
      expect(() => loadManifest(kbDir)).toThrow(expect.objectContaining({
        code: kbErrors.KB_CORRUPTED,
        path: path.join(kbDir, 'manifest.json')
      }));
    });

    it('throws KB_CORRUPTED when required fields are missing', () => {
      const kbDir = path.join(fixtureRoot, 'missing-field');
      fs.mkdirSync(kbDir, { recursive: true });
      fs.writeFileSync(path.join(kbDir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, minCliVersion: '0.0.1' }));
      expect(() => loadManifest(kbDir)).toThrow(expect.objectContaining({
        code: kbErrors.KB_CORRUPTED,
        field: 'kbSha256'
      }));
    });
  });

  describe('verifySha256', () => {
    it('returns ok true on match', async () => {
      const filePath = path.join(fixtureRoot, 'hash.txt');
      fs.writeFileSync(filePath, 'hello');
      const expected = crypto.createHash('sha256').update('hello').digest('hex');
      await expect(verifySha256(filePath, expected)).resolves.toEqual({ ok: true, actual: expected });
    });

    it('returns ok false with expected and actual on mismatch', async () => {
      const filePath = path.join(fixtureRoot, 'hash-mismatch.txt');
      fs.writeFileSync(filePath, 'hello');
      const expected = '0'.repeat(64);
      const result = await verifySha256(filePath, expected);
      expect(result).toEqual({
        ok: false,
        expected,
        actual: crypto.createHash('sha256').update('hello').digest('hex')
      });
    });
  });
});
