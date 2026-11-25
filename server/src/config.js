// Resolve relative to this module, independent of npm/checker working directory.
// Existing environment variables (including the checker's PORT) take precedence.
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const env = (name, fallback) => process.env[name] ?? fallback;
const required = (name) => {
  const value = process.env[name];
  if (!value || value.startsWith('REPLACE_')) {
    throw new Error(`Configure ${name} in the environment or server/.env`);
  }
  return value;
};

export const config = {
  port: Number(env('PORT', '4000')),
  mongo: env('MONGO_URL', 'mongodb://localhost:27017/switchboard'),
  redis: env('REDIS_URL', 'redis://localhost:6379'),
  grader: required('GRADER_TOKEN'),
  origin: env('WEB_ORIGIN', 'http://localhost:5173'),
  pigeon: {
    url: env('PIGEON_URL', 'http://localhost:4010'),
    secret: required('PIGEON_WEBHOOK_SECRET'),
    keys: {
      ws_acme: required('PIGEON_KEY_WS_ACME'),
      ws_globex: required('PIGEON_KEY_WS_GLOBEX'),
    },
  },
  oidc: {
    issuer: env('OIDC_ISSUER', 'http://localhost:4020'),
    client: env('OIDC_CLIENT_ID', 'switchboard-web'),
    secret: required('OIDC_CLIENT_SECRET'),
    redirect: env('OIDC_REDIRECT_URI', 'http://localhost:4000/auth/callback'),
  },
  timeouts: { provider: 5000, oidc: 10000, lease: 15000 },
};
