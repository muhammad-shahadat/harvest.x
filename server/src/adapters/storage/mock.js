// MOCK storage: saves private files in server/uploads/private. For LOCAL testing only.
// (On Render the disk is temporary, so files vanish on restart. Use STORAGE_PROVIDER=cloudinary there.)
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const env = require('../../config/env');

const DIR = path.resolve(env.UPLOAD_DIR, 'private');

module.exports = {
  name: 'mock',

  async saveCardImage({ buffer, ext }) {
    await fs.mkdir(DIR, { recursive: true });
    const id = `${crypto.randomUUID()}.${ext}`;
    await fs.writeFile(path.join(DIR, id), buffer);
    return id;
  },

  // How the server should hand the file to an authorized admin.
  async getAccess(id) {
    return { type: 'file', path: path.join(DIR, path.basename(id)) };
  },

  async remove(id) {
    try { await fs.unlink(path.join(DIR, path.basename(id))); } catch (_) { /* already gone */ }
  },
};
