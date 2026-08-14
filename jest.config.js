/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',

  setupFiles: ['<rootDir>/jest.setup.js'],

  testMatch: [
    '<rootDir>/src/tests/**/*.test.ts',
    '<rootDir>/src/tests/**/*.test.tsx',
  ],

  clearMocks: true,
  restoreMocks: true,
};
