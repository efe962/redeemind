import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['coverage/**', 'dist/**', 'node_modules/**', 'reports/**'],
  },
  eslintConfigPrettier,
];
