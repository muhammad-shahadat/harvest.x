// CLOUDINARY storage: farmer-card photos are saved as "authenticated" (private) assets.
// Nobody can open them without a signed link, and only an admin request creates one.
// NOTE: written from Cloudinary's docs but NOT tested with real credentials yet.
// First real test: log in as a farmer, submit an application with a photo, then open it as admin.
const cloudinary = require('cloudinary').v2; // reads CLOUDINARY_URL from the environment

module.exports = {
  name: 'cloudinary',

  saveCardImage({ buffer }) {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'harvestx/farmer-cards', type: 'authenticated', resource_type: 'image' },
        (err, result) => (err ? reject(err) : resolve(result.public_id))
      );
      stream.end(buffer);
    });
  },

  // Public crop photos. Cloudinary shrinks them for slow connections: max 1600px wide, automatic quality (FR-10).
  saveListingImage({ buffer }) {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'harvestx/listings', type: 'upload', resource_type: 'image',
          transformation: [{ width: 1600, crop: 'limit', quality: 'auto:good', fetch_format: 'auto' }] },
        (err, result) => (err ? reject(err) : resolve({ id: result.public_id, url: result.secure_url }))
      );
      stream.end(buffer);
    });
  },

  async removeListingImage(publicId) {
    try { await cloudinary.uploader.destroy(publicId, { type: 'upload', resource_type: 'image' }); } catch (_) { /* ignore */ }
  },

  async getAccess(publicId) {
    const url = cloudinary.url(publicId, { type: 'authenticated', sign_url: true, secure: true, resource_type: 'image' });
    return { type: 'url', url };
  },

  async remove(publicId) {
    try { await cloudinary.uploader.destroy(publicId, { type: 'authenticated', resource_type: 'image' }); } catch (_) { /* ignore */ }
  },
};
