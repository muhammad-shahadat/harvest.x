// Turns a Google "ID token" (from the React Google button) into { sub, email, emailVerified, name, picture }.
//  - AUTH_PROVIDER=google : real verification with Google (the real thing, also for the live demo)
//  - AUTH_PROVIDER=mock   : DEV ONLY. token looks like  "mock|someone@gmail.com|Some Name"
const env = require('../config/env');
const { AppError } = require('../utils/errors');

let client;

async function verifyWithGoogle(idToken) {
  if (!client) {
    const { OAuth2Client } = require('google-auth-library');
    client = new OAuth2Client(env.GOOGLE_CLIENT_ID);
  }
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch (e) {
    throw new AppError(401, 'INVALID_GOOGLE_TOKEN', 'Google token could not be verified');
  }
  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === true,
    name: payload.name,
    picture: payload.picture,
  };
}

async function verifyMock(idToken) {
  const [prefix, email, name] = String(idToken).split('|');
  if (prefix !== 'mock' || !email || !email.includes('@')) {
    throw new AppError(401, 'INVALID_GOOGLE_TOKEN', 'Mock token must look like mock|email|name');
  }
  return { sub: `mock-${email.toLowerCase()}`, email, emailVerified: true, name: name || email, picture: null };
}

module.exports = { verify: (idToken) => (env.AUTH_PROVIDER === 'mock' ? verifyMock(idToken) : verifyWithGoogle(idToken)) };
