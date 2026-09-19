// The library build: ES module and UMD, React left to the application.
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

module.exports = [
  {
    ...common,
    experiments: { outputModule: true },
    output: { path: path.join(__dirname, 'dist/lib'), filename: 'uamodeler.esm.js', library: { type: 'module' }, chunkFilename: 'uamodeler.[name].esm.js' },
  },
  {
    ...common,
    // In a page without a bundler React comes from the globals React and ReactDOM.
    externals: {
      react: { root: 'React', commonjs: 'react', commonjs2: 'react', amd: 'react' },
      'react-dom': { root: 'ReactDOM', commonjs: 'react-dom', commonjs2: 'react-dom', amd: 'react-dom' },
      'react/jsx-runtime': { root: ['React', 'jsxRuntime'], commonjs: 'react/jsx-runtime', commonjs2: 'react/jsx-runtime', amd: 'react/jsx-runtime' },
    },
    output: { path: path.join(__dirname, 'dist/lib'), filename: 'uamodeler.umd.js', library: { name: 'UaModeler', type: 'umd' }, globalObject: 'this', chunkFilename: 'uamodeler.[name].umd.js' },
  },
];
