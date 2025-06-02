// const path = require("path");
// const webpack = require("webpack");
// const NodePolyfillPlugin = require("node-polyfill-webpack-plugin");
// const CopyPlugin = require("copy-webpack-plugin");
// const { CleanWebpackPlugin } = require("clean-webpack-plugin");

// // Add this debug plugin
// class DebugPlugin {
//   apply(compiler) {
//     compiler.hooks.emit.tapAsync("DebugPlugin", (compilation, callback) => {
//       console.log("\nFiles being generated:");
//       for (let filename in compilation.assets) {
//         const size = compilation.assets[filename].size();
//         console.log(`- ${filename}: ${size} bytes`);
//       }
//       callback();
//     });
//   }
// }

// // Define the standard platforms
// const platforms = ["indeed", "linkedin", "glassdoor"];

// const baseAliases = {
//   "@shared": path.resolve(__dirname, "src/shared"),
//   "@platforms": path.resolve(__dirname, "src/platforms"),
// };

// const commonConfig = {
//   mode: "production",
//   devtool: false,
//   resolve: {
//     extensions: [".js", ".json"],
//     alias: baseAliases,
//     fallback: {
//       path: require.resolve("path-browserify"),
//       crypto: require.resolve("crypto-browserify"),
//       stream: require.resolve("stream-browserify"),
//       os: require.resolve("os-browserify/browser"),
//       events: require.resolve("events/"),
//       buffer: require.resolve("buffer/"),
//       fs: false,
//       process: require.resolve("process/browser"),
//     },
//   },
//   plugins: [
//     new webpack.ProvidePlugin({
//       process: "process/browser",
//       Buffer: ["buffer", "Buffer"],
//     }),
//     new NodePolyfillPlugin(),
//   ],
//   optimization: {
//     minimize: true, // Ensure all bundles are minified
//   },
// };

// const createEntries = (type) => {
//   const entries = type === "background" ? { background: "./src/background.js" } : {};

//   // Add standard platform entries
//   platforms.forEach((platform) => {
//     entries[`${platform}/${type}`] = `./src/platforms/${platform}/${type}.js`;
//   });

//   // Special handling for external with nested structure
//   if (type === "background") {
//     entries["external/background"] = "./src/platforms/external/background/background.js";
//   } else if (type === "content") {
//     entries["external/content"] = "./src/platforms/external/content/content.js";
//   }

//   return entries;
// };

// const backgroundConfig = {
//   ...commonConfig,
//   name: "background",
//   target: "webworker",
//   experiments: {
//     outputModule: true,
//   },
//   entry: createEntries("background"),
//   output: {
//     filename: "[name].bundle.js",
//     path: path.resolve(__dirname, "dist"),
//     module: true,
//   },
//   plugins: [
//     ...commonConfig.plugins,
//     new CleanWebpackPlugin(),
//     new CopyPlugin({
//       patterns: [
//         {
//           from: path.resolve(__dirname, "manifest.json"),
//           to: path.resolve(__dirname, "dist/manifest.json"),
//         },
//         {
//           from: path.resolve(__dirname, "icons"),
//           to: path.resolve(__dirname, "dist/icons"),
//         },
//       ],
//     }),
//     new DebugPlugin(),
//   ],
// };

// const contentConfig = {
//   ...commonConfig,
//   name: "content",
//   target: "web",
//   entry: createEntries("content"),
//   output: {
//     filename: "[name].bundle.js",
//     path: path.resolve(__dirname, "dist"),
//   },
// };

// module.exports = [backgroundConfig, contentConfig];

const path = require("path");
const webpack = require("webpack");
const NodePolyfillPlugin = require("node-polyfill-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");

// Add this debug plugin
class DebugPlugin {
  apply(compiler) {
    compiler.hooks.emit.tapAsync("DebugPlugin", (compilation, callback) => {
      console.log("\nFiles being generated:");
      for (let filename in compilation.assets) {
        const size = compilation.assets[filename].size();
        console.log(`- ${filename}: ${size} bytes`);
      }
      callback();
    });
  }
}

const platforms = [
  "indeed",
  "indeed_glassdoor",
  "linkedin",
  "external",
  "glassdoor",
  "ziprecruiter",
  "lever",
  "workable",
  "breezy",
  "recruitee",
];

const baseAliases = {
  "@shared": path.resolve(__dirname, "src/shared"),
  "@platforms": path.resolve(__dirname, "src/platforms"),
};

const commonConfig = {
  mode: "production",
  devtool: false,
  resolve: {
    extensions: [".js", ".json"],
    alias: baseAliases,
    fallback: {
      path: require.resolve("path-browserify"),
      crypto: require.resolve("crypto-browserify"),
      stream: require.resolve("stream-browserify"),
      os: require.resolve("os-browserify/browser"),
      events: require.resolve("events/"),
      buffer: require.resolve("buffer/"),
      fs: false,
      process: require.resolve("process/browser"),
    },
  },
  plugins: [
    new webpack.ProvidePlugin({
      process: "process/browser",
      Buffer: ["buffer", "Buffer"],
    }),
    new NodePolyfillPlugin(),
  ],
  optimization: {
    minimize: true, // Ensure all bundles are minified
  },
};

const createEntries = (type) => {
  const entries =
    type === "background" ? { background: "./src/background.js" } : {};

  platforms.forEach((platform) => {
    entries[`${platform}/${type}`] = `./src/platforms/${platform}/${type}.js`;
  });

  return entries;
};

const backgroundConfig = {
  ...commonConfig,
  name: "background",
  target: "webworker",
  experiments: {
    outputModule: true,
  },
  entry: createEntries("background"),
  output: {
    filename: "[name].bundle.js",
    path: path.resolve(__dirname, "dist"),
    module: true,
  },
  plugins: [
    ...commonConfig.plugins,
    new CleanWebpackPlugin(),
    new CopyPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, "manifest.json"),
          to: path.resolve(__dirname, "dist/manifest.json"),
        },
        {
          from: path.resolve(__dirname, "icons"),
          to: path.resolve(__dirname, "dist/icons"),
        },
      ],
    }),
    new DebugPlugin(),
  ],
};

const contentConfig = {
  ...commonConfig,
  name: "content",
  target: "web",
  entry: createEntries("content"),
  output: {
    filename: "[name].bundle.js",
    path: path.resolve(__dirname, "dist"),
  },
};

module.exports = [backgroundConfig, contentConfig];
