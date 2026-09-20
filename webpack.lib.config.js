// The library build: ES module and UMD of the whole modeler, and the NodeSet
// core on its own, which runs in Node as well because it touches no window.
const path = require('path');

const common = {
  entry: './src/index.ts',
  resolve: { extensions: ['.ts', '.tsx', '.js'] },
  module: {
    rules: [
      { test: /\.[jt]sx?$/, exclude: /node_modules/, use: 'babel-loader' },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
      { test: /\.xml$/, type: 'asset/source' },
    ],
  },
  externals: { react: 'react', 'react-dom': 'react-dom', 'react/jsx-runtime': 'react/jsx-runtime' },
  performance: { hints: false },
  devtool: 'source-map',
};

// The bundled NodeSets are loaded with import() so a page fetches them only
// when it needs them; for the core they belong inside the one file a script
// requires, so the dynamic import is resolved while bundling.
const core = {
  ...common,
  entry: './src/core.ts',
  externals: {},
  module: { ...common.module, parser: { javascript: { dynamicImportMode: 'eager' } } },
};

module.exports = [
  {
    ...common,
    experiments: { outputModule: true },
    output: { path: path.join(__dirname, 'dist/lib'), filename: 'nodeset.esm.js', library: { type: 'module' }, chunkFilename: 'nodeset.[name].esm.js' },
  },
  {
    ...common,
    // In a page without a bundler React comes from the globals React and ReactDOM.
    externals: {
      react: { root: 'React', commonjs: 'react', commonjs2: 'react', amd: 'react' },
      'react-dom': { root: 'ReactDOM', commonjs: 'react-dom', commonjs2: 'react-dom', amd: 'react-dom' },
      'react/jsx-runtime': { root: ['React', 'jsxRuntime'], commonjs: 'react/jsx-runtime', commonjs2: 'react/jsx-runtime', amd: 'react/jsx-runtime' },
    },
    output: { path: path.join(__dirname, 'dist/lib'), filename: 'nodeset.umd.js', library: { name: 'NodeSet', type: 'umd' }, globalObject: 'this', chunkFilename: 'nodeset.[name].umd.js' },
  },
  {
    // The core for Node: CommonJS, and the bundled NodeSets inside the file
    // rather than in chunks beside it, so a script needs one require.
    ...core,
    target: 'node',
    optimization: { splitChunks: false, runtimeChunk: false },
    output: {
      path: path.join(__dirname, 'dist/lib'),
      filename: 'nodeset.core.cjs',
      library: { type: 'commonjs2' },
    },
  },
  {
    // The same core as an ES module, for a page or for "import" in Node.
    ...core,
    experiments: { outputModule: true },
    optimization: { splitChunks: false, runtimeChunk: false },
    output: {
      path: path.join(__dirname, 'dist/lib'),
      filename: 'nodeset.core.mjs',
      library: { type: 'module' },
      chunkFormat: 'module',
    },
  },
];
