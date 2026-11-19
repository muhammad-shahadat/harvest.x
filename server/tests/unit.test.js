const { normalizeMobile } = require('../src/utils/mobile');
const { normalizeCardNumber, encrypt, decrypt, hashCard } = require('../src/utils/cardCrypto');
const { detectImageType } = require('../src/utils/imageType');

describe('mobile normalization (FR-1 edge cases)', () => {
  test.each([
    ['01712345678', '01712345678'],
    ['+8801712345678', '01712345678'],
    ['8801712345678', '01712345678'],
    ['০১৭১২৩৪৫৬৭৮', '01712345678'],          // Bangla digits
    ['017 1234-5678', '01712345678'],         // spaces and dashes
  ])('%s -> %s', (input, expected) => expect(normalizeMobile(input)).toBe(expected));

  test.each(['', '12345', '01212345678', '0171234567', 'abc', null])('rejects %p', (input) => {
    expect(normalizeMobile(input)).toBeNull();
  });
});

describe('farmer card protection (FR-40)', () => {
  test('encrypt then decrypt gives the original; ciphertext hides the number', () => {
    const enc = encrypt('AB123456');
    expect(enc).not.toContain('AB123456');
    expect(decrypt(enc)).toBe('AB123456');
  });
  test('same card -> same hash (duplicate detection), different card -> different hash', () => {
    expect(hashCard('AB123456')).toBe(hashCard('AB123456'));
    expect(hashCard('AB123456')).not.toBe(hashCard('AB123457'));
  });
  test('normalizes Bangla digits, spaces, lowercase; rejects too short', () => {
    expect(normalizeCardNumber('ab ১২৩-৪৫৬')).toBe('AB123456');
    expect(normalizeCardNumber('123')).toBeNull();
  });
});

describe('image type check by file bytes', () => {
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(20)]);
  test('accepts a real PNG header', () => expect(detectImageType(png).ext).toBe('png'));
  test('rejects a text file renamed to .jpg', () => expect(detectImageType(Buffer.from('hello world, not an image'))).toBeNull());
});
