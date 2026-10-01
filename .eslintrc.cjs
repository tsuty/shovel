module.exports = {
  root: true,
  env: { es2022: true, node: true, browser: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: ['./tsconfig.node.json', './tsconfig.web.json', './tsconfig.test.json'],
    tsconfigRootDir: __dirname
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended-type-checked',
    'plugin:react-hooks/recommended'
  ],
  ignorePatterns: ['out', 'dist', 'release', 'node_modules', '*.cjs', '*.config.ts', '*.config.js'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/switch-exhaustiveness-check': 'error',
    '@typescript-eslint/no-unnecessary-condition': 'error',
    '@typescript-eslint/restrict-template-expressions': [
      'error',
      { allowNumber: true, allowBoolean: true, allowNullish: false, allowAny: false }
    ],
    'react-hooks/exhaustive-deps': 'error'
  },
  overrides: [
    {
      files: ['test/**/*.ts'],
      rules: { '@typescript-eslint/no-unsafe-assignment': 'off' }
    }
  ]
}
