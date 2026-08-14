# Dependency tree remediation — 2026-08-12

The previous baseline updated Expo SDK 57 patch packages but retained a stale `package-lock.json` produced with React Native 0.86.0 transitive metadata.

## Root cause

- `react-native@0.86.2` requires `@react-native/jest-preset@0.86.2` when that optional peer is installed.
- `react-native@0.86.2` depends on `@react-native/virtualized-lists@0.86.2`.
- `jest-expo@57.0.4` requires `@react-native/jest-preset@^0.86.2`.
- The stale lock still pinned both React Native packages at `0.86.0`, making `npm install` fail with ERESOLVE.

## Changes

- `devDependencies.@react-native/jest-preset`: `0.86.0` -> `0.86.2`.
- Removed the stale `package-lock.json` from this remediation archive so npm can generate a coherent lock from the corrected manifest.

## First install

```bash
rm -rf node_modules package-lock.json
npm install
npm dedupe
npm run dependencies:lock:check
npm run typecheck
npm test -- --runInBand
npx expo-doctor
```

After `npm install`, commit the newly generated `package-lock.json`. Subsequent clean installs should use `npm ci`.
