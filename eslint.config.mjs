// One rule on purpose: hooks in the same order on every render. Breaking it
// unmounted the whole page (a hook after an early return in FieldsSection).
// The rest of the code style is kept by review, not by a linter.

import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error' },
  },
];
