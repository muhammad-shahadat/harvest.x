// MOCK image check. It cannot really look at the picture, so it follows the FILE NAME. This makes the demo predictable:
//   name contains "mismatch"  -> mismatch      "uncertain" -> uncertain      "fail" -> failed      anything else -> match
// (e.g. upload "tomato-mismatch.jpg" to show the admin review flow).
const OUTCOMES = [
  ['mismatch', 0.12],
  ['uncertain', 0.55],
  ['fail', null],
];

module.exports = {
  name: 'mock',

  async check({ originalName }) {
    const name = String(originalName || '').toLowerCase();
    const hit = OUTCOMES.find(([word]) => name.includes(word));
    if (!hit) return { result: 'match', confidence: 0.95, provider: 'mock' };
    const [word, confidence] = hit;
    return { result: word === 'fail' ? 'failed' : word, confidence, provider: 'mock' };
  },
};
