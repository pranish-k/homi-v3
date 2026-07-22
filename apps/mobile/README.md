# @homi/mobile

The HOMI iOS/Android client (Expo React Native, TypeScript, expo-router).
TestFlight v1 ships the expense loop only; see epic E6 in `docs/agile/PRODUCT_BACKLOG.md`.

Dev builds target the deployed staging API by default (`src/api/config.ts`); override with `EXPO_PUBLIC_API_URL`.

```sh
npm run ios --workspace @homi/mobile     # Expo dev server + iOS simulator
npm run typecheck --workspace @homi/mobile
```
