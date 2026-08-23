const PRODUCTION_PROJECT_REF = 'kagvxhyvxxypspdxcuxz';
const SENSITIVE_TARGET_KEY = /(?:SUPABASE|DATABASE_URL|POSTGRES|PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD)/i;
const URL_KEY = /(?:SUPABASE_URL|DATABASE_URL|POSTGRES_URL|PGHOST)/i;

const isLoopbackTarget = (value) => {
  try {
    const parsed = new URL(value.includes('://') ? value : `postgresql://${value}`);
    return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  } catch {
    return false;
  }
};

export const assertCiSafeEnvironment = (
  environment = process.env,
  { requireLoopback = false } = {},
) => {
  if (String(environment.NODE_ENV ?? '').toLowerCase() === 'production'
      || String(environment.DIETBRIDGE_ENV ?? '').toLowerCase() === 'production') {
    throw new Error('Automated quality tests refuse Production environment mode.');
  }

  for (const [key, rawValue] of Object.entries(environment)) {
    if (!SENSITIVE_TARGET_KEY.test(key) || typeof rawValue !== 'string' || !rawValue.trim()) continue;
    const value = rawValue.trim();
    if (value.toLowerCase().includes(PRODUCTION_PROJECT_REF)) {
      throw new Error(`Automated quality tests refuse the known Production project (${key}).`);
    }
    if (requireLoopback && URL_KEY.test(key) && !isLoopbackTarget(value)) {
      throw new Error(`Disposable integration tests require a loopback target (${key}).`);
    }
  }

  return true;
};

export const ciSafetyConstants = Object.freeze({
  productionProjectRef: PRODUCTION_PROJECT_REF,
});
