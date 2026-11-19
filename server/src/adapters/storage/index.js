// Picks the storage implementation from STORAGE_PROVIDER. Business code only uses these 3 functions:
//   saveCardImage({buffer, ext}) -> id       getAccess(id) -> {type:'file'|'url', ...}       remove(id)
const env = require('../../config/env');

module.exports = env.STORAGE_PROVIDER === 'cloudinary' ? require('./cloudinary') : require('./mock');
