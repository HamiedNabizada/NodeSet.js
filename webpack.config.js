const HtmlWebpackPlugin = require('html-webpack-plugin');
const path = require('path');

module.exports = (env, argv) => ({
  entry: './app/app.tsx',
  output: {
    path: path.join(__dirname, 'dist/web'),
    filename: argv.mode === 'production' ? '[name].[contenthash].js' : '[name].js',
    clean: true,
  },
  resolve: { extensions: ['.ts', '.tsx', '.js'] },
  module: {
    rules: [
      { test: /\.[jt]sx?$/, exclude: /node_modules/, use: 'babel-loader' },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
      // The bundled NodeSets are loaded as text and parsed at run time.
      { test: /\.xml$/, type: 'asset/source' },
    ],
  },
  plugins: [new HtmlWebpackPlugin({ template: './app/index.html', title: 'NodeSet.js' })],
  devServer: { port: 3002, hot: true },
  // The base NodeSet is a lazy chunk of several MB by nature.
  performance: { hints: false },
  devtool: argv.mode === 'production' ? false : 'eval-cheap-module-source-map',
});
