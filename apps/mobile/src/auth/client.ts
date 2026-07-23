import { createAuthClient } from 'better-auth/react';
import { emailOTPClient, magicLinkClient } from 'better-auth/client/plugins';
import { expoClient } from '@better-auth/expo/client';
import * as SecureStore from 'expo-secure-store';

// expoClient's declared types do not satisfy BetterAuthClientPlugin
// under TS 6 strictness, and one bad element collapses inference for
// the whole plugins array (losing magicLink actions and the session
// shape). This is the plugin's true surface minus the server-plugin
// inference marker; it contributes no client actions we call.
type ExpoClientPlugin = {
  id: 'expo';
  getActions: () => { getCookie: () => string };
  fetchPlugins: [];
};

import { API_BASE } from '@/api/config';

// HOMI-31: Better Auth client against the deployed API. The Expo plugin
// persists the session cookie in SecureStore, so sign-in survives app
// restarts until an explicit sign-out or server-side revocation.
export const authClient = createAuthClient({
  baseURL: API_BASE,
  plugins: [
    magicLinkClient(),
    // HOMI-31: the deep-link-free sign-in path - request a code, type it
    // in, and the session lands on this request without any homi:// hop.
    emailOTPClient(),
    expoClient({
      scheme: 'homi',
      storagePrefix: 'homi',
      storage: SecureStore,
    }) as unknown as ExpoClientPlugin,
  ],
});
