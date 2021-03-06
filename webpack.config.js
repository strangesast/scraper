const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');
const config = require('./package.json');

module.exports = {
  entry: {
    index: './src/index.js',
    worker: './src/worker.js'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js'
  },
  module: {
    rules: [
      {
        test: /\.less$/i,
        use: ['style-loader', 'css-loader', 'less-loader']
      },
      {
        test: /\.png$/i,
        use: ['file-loader']
      }
    ]
  },
  plugins: [
    /*
    new webpack.optimize.UglifyJsPlugin({
      sourceMap: true
    }),
    */
    new HtmlWebpackPlugin({
      template: './src/index.html',
      title: config.name
    })
  ],
  node: {
    console: true,
    fs: 'empty',
    net: 'empty',
    tls: 'empty'
  }
};
