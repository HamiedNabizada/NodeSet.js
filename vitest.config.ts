import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      // As webpack's asset/source: an imported .xml file is its text.
      name: 'xml-as-text',
      transform(code, id) {
        return id.endsWith('.xml') ? { code: `export default ${JSON.stringify(code)};`, map: null } : undefined;
      },
    },
  ],
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    globals: true,
    testTimeout: 20000,
  },
});
