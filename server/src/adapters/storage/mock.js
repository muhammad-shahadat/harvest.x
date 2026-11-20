// MOCK storage: saves private files in server/uploads/private. For LOCAL testing only.
// (On Render the disk is temporary, so files vanish on restart. Use STORAGE_PROVIDER=cloudinary there.)
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const env = require('../../config/env');

const DIR = path.resolve(env.UPLOAD_DIR, 'private');
const PUBLIC_DIR = path.resolve(env.UPLOAD_DIR, 'public'); // served by the server at /media (see app.js)

module.exports = {
  name: 'mock',

  async saveCardImage({ buffer, ext }) {
    await fs.mkdir(DIR, { recursive: true });
    const id = `${crypto.randomUUID()}.${ext}`;
    await fs.writeFile(path.join(DIR, id), buffer);
    return id;
  },

  // Public crop photos (listings). Returns { id, url }. The url is relative: the React app adds the API address.
  async saveListingImage({ buffer, ext }) {
    await fs.mkdir(PUBLIC_DIR, { recursive: true });
    const id = `${crypto.randomUUID()}.${ext}`;
    await fs.writeFile(path.join(PUBLIC_DIR, id), buffer);
    return { id, url: `/media/${id}` };
  },

  async removeListingImage(id) {
    try { await fs.unlink(path.join(PUBLIC_DIR, path.basename(id))); } catch (_) { /* already gone */ }
  },

  publicDir: PUBLIC_DIR,

  // How the server should hand the file to an authorized admin.
  async getAccess(id) {
    return { type: 'file', path: path.join(DIR, path.basename(id)) };
  },

  async remove(id) {
    try { await fs.unlink(path.join(DIR, path.basename(id))); } catch (_) { /* already gone */ }
  },
};
