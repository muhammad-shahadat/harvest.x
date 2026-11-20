// FR-11: AI-assisted crop image check. Business code only calls:
//   check({ buffer, originalName, cropNameEn, cropNameBn }) -> { result, confidence, provider }
//   result = 'match' | 'mismatch' | 'uncertain' | 'failed'
// Only a MOCK exists today (free-tier demo). A real vision API can replace it without touching the services.
// The result is a hint for the admin. It is NEVER proof of ownership, quantity or quality (FR-11).
const provider = require('./mock'); // IMAGE_CHECK_PROVIDER only allows "mock" for now (env.js)

const TIMEOUT_MS = 8000;

// Never lets a slow or broken provider block an upload: any error or timeout becomes "failed".
async function check(input) {
  try {
    return await Promise.race([
      provider.check(input),
      new Promise((_, reject) => setTimeout(() => reject(new Error('image check timeout')), TIMEOUT_MS)),
    ]);
  } catch (e) {
    return { result: 'failed', confidence: null, provider: provider.name };
  }
}

module.exports = { check, name: provider.name };
