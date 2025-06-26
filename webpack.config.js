const path = require("path");
const webpack = require("webpack");
const NodePolyfillPlugin = require("node-polyfill-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");
const fs = require("fs");

// Enhanced debug plugin
class DebugPlugin {
  constructor(configName, entries) {
    this.configName = configName;
    this.entries = entries;
  }
  
  apply(compiler) {
    // Debug entries at the start
    console.log(`\n=== ${this.configName.toUpperCase()} CONFIG ===`);
    console.log("Entry points configured:");
    for (let entryName in this.entries) {
      console.log(`- ${entryName}: ${this.entries[entryName]}`);
    }

    // Debug compilation errors
    compiler.hooks.compilation.tap("DebugPlugin", (compilation) => {
      compilation.hooks.finishModules.tap("DebugPlugin", (modules) => {
        const errors = compilation.errors;
        const warnings = compilation.warnings;
        
        if (errors.length > 0) {
          console.log(`\n❌ ${this.configName} compilation errors:`);
          errors.forEach(error => console.log(error.message));
        }
        
        if (warnings.length > 0) {
          console.log(`\n⚠️  ${this.configName} compilation warnings:`);
          warnings.forEach(warning => console.log(warning.message));
        }
      });
    });

    // Debug output files
    compiler.hooks.emit.tapAsync("DebugPlugin", (compilation, callback) => {
      console.log(`\n✅ ${this.configName} files being generated:`);
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
    minimize: true,
  },
};

const createEntries = (type) => {
  console.log(`\nCreating entries for type: ${type}`);
  
  const entries = type === "background" ? { background: "./src/background.js" } : {};
  const foundPlatforms = [];
  const missingPlatforms = [];

  platforms.forEach((platform) => {
    const entryPath = `./src/platforms/${platform}/${type}.js`;
    const fullPath = path.resolve(__dirname, entryPath.substring(2)); // Remove ./
    
    // Check if file exists
    if (fs.existsSync(fullPath)) {
      entries[`${platform}/${type}`] = entryPath;
      foundPlatforms.push(platform);
      console.log(`✓ Found: ${entryPath}`);
      
      // Check if file has content
      const fileContent = fs.readFileSync(fullPath, 'utf8');
      if (fileContent.trim().length === 0) {
        console.warn(`⚠️  Empty file: ${entryPath}`);
      } else {
        console.log(`  Content size: ${fileContent.length} characters`);
      }
    } else {
      missingPlatforms.push(platform);
      console.error(`✗ Missing: ${entryPath}`);
    }
  });

  if (missingPlatforms.length > 0) {
    console.error(`\n❌ Missing ${type} scripts for platforms: ${missingPlatforms.join(', ')}`);
  }

  console.log(`Total entries for ${type}:`, Object.keys(entries).length);
  console.log(`Found platforms: ${foundPlatforms.join(', ')}`);
  
  return entries;
};

// Create entries and store them
const backgroundEntries = createEntries("background");
const contentEntries = createEntries("content");

const backgroundConfig = {
  ...commonConfig,
  name: "background", 
  target: "webworker",
  experiments: {
    outputModule: true,
  },
  entry: backgroundEntries,
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
    new DebugPlugin("background", backgroundEntries),
  ],
};

const contentConfig = {
  ...commonConfig,
  name: "content",
  target: "web",
  entry: contentEntries,
  output: {
    filename: "[name].bundle.js", 
    path: path.resolve(__dirname, "dist"),
  },
  plugins: [
    ...commonConfig.plugins,
    new DebugPlugin("content", contentEntries),
  ],
};

module.exports = [backgroundConfig, contentConfig];