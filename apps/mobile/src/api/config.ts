// Dev builds target the deployed staging API by default (Sprint 7 decision):
// no local-only prototypes. Override per build with EXPO_PUBLIC_API_URL.
const STAGING_API_URL = 'https://homi-api-staging-528839783533.us-east4.run.app';

export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? STAGING_API_URL;
