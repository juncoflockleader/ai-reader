export const isProduction = process.env.NODE_ENV === "production";

const configuredHost = process.env.HOST?.trim();

export const isPublicExposure = process.env.STUDYREADER_PUBLIC === "true";
export const host = configuredHost || "127.0.0.1";
export const port = parsePort(process.env.PORT, 3127);
export const uploadMaxMb = parsePositiveNumber(process.env.STUDYREADER_UPLOAD_MAX_MB, 512);
export const uploadMaxBytes = Math.floor(uploadMaxMb * 1024 * 1024);

export type BasicAuthCredentials = {
  user: string;
  password: string;
};

export function getBasicAuthCredentials(): BasicAuthCredentials | null {
  const user = process.env.STUDYREADER_USER ?? "";
  const password = process.env.STUDYREADER_PASSWORD ?? "";
  return user && password ? { user, password } : null;
}

export function validateDeploymentConfig() {
  const user = process.env.STUDYREADER_USER ?? "";
  const password = process.env.STUDYREADER_PASSWORD ?? "";
  const authPartiallyConfigured = Boolean(user || password) && !(user && password);
  if (authPartiallyConfigured) {
    throw new Error("Set both STUDYREADER_USER and STUDYREADER_PASSWORD, or leave both unset for localhost-only development.");
  }

  if (bindsAllInterfaces(host) && !getBasicAuthCredentials()) {
    throw new Error("Refusing to listen on all interfaces without auth. Set STUDYREADER_USER and STUDYREADER_PASSWORD first.");
  }

  if (isPublicExposure && !getBasicAuthCredentials()) {
    throw new Error("Refusing public exposure without auth. Set STUDYREADER_USER and STUDYREADER_PASSWORD first.");
  }
}

function bindsAllInterfaces(value: string) {
  return value === "0.0.0.0" || value === "::";
}

function parsePort(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) return parsed;
  throw new Error(`Invalid PORT value: ${value}`);
}

function parsePositiveNumber(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  throw new Error(`Invalid positive number: ${value}`);
}
