const env = require('./config/env');
const app = require('./app');

app.listen(env.PORT, () => {
  console.log(`HarvestX server running on port ${env.PORT} (auth: ${env.AUTH_PROVIDER}, storage: ${env.STORAGE_PROVIDER})`);
});
