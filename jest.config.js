module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  modulePathIgnorePatterns: [
    '<rootDir>/.next/',
    '<rootDir>/dist-electron/',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  transformIgnorePatterns: [
    'node_modules/(?!(nanoid)/)'
  ]
}
