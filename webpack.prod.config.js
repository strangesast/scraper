const path = require('path');
const ExtractTextPlugin = require('extract-text-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');
const config = require('./package.json');

const extractLESS = new ExtractTextPlugin('./dist/bundle.css');

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
        use: ExtractTextPlugin.extract({
          fallback: 'style-loader',
          use: 'css-loader!less-loader'
        })
      },
      {
        test: /\.png$/i,
        loader: 'file-loader?name=/[name].png'
      }
    ]
  },
  plugins: [
    /*
    new webpack.optimize.UglifyJsPlugin(),
    */
    new HtmlWebpackPlugin({
      template: './src/index.html',
      title: config.name
    }),
    new ExtractTextPlugin({
      filename: 'bundle.css',
      disable: false,
      allChunks: true
    })
  ]
};
