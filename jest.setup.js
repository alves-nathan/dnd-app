// Native persistence is unavailable in Jest's Node environment.
// Use the official AsyncStorage mock for every suite that reaches a store
// indirectly through a barrel export.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
