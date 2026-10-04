// eslint-disable-next-line no-unused-vars
const webpack = require('webpack')
const path = require('path')
// const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin

// Minify the index.js by removing unused minecraft data. Since the worker only needs to do meshing,
// we can remove all the other data unrelated to meshing.
const blockedIndexFiles = ['blocksB2J', 'blocksJ2B', 'blockMappings', 'steve', 'recipes']

// PRISMARINE_VIEWER_VERSIONS=26.3 (comma separated) builds for those versions only. The worker
// bundles each version's block, biome and tint data, which for every version is tens of MB; with
// this, only the minecraft-data folders those versions read from (per dataPaths.json) go in, plus
// pc/common and bedrock/common, which minecraft-data's index reads on load for every version.
const onlyVersions = process.env.PRISMARINE_VIEWER_VERSIONS?.split(',').map(v => v.trim()).filter(Boolean)
const keptFolders = onlyVersions && new Set(['pc/common', 'bedrock/common', ...onlyVersions.flatMap(version =>
  Object.values(require('minecraft-data/minecraft-data/data/dataPaths.json').pc[version] ?? {}))])
function otherVersionData (req) {
  if (!keptFolders) return false
  const folder = req.request.replace(/\\/g, '/').match(/\/data\/((?:pc|bedrock)\/[^/]+)\//)?.[1]
  return folder !== undefined && !keptFolders.has(folder)
}
const allowedWorkerFiles = ['blocks', 'blockCollisionShapes', 'tints', 'blockStates',
  'biomes', 'features', 'version', 'legacy', 'versions', 'version', 'protocolVersions']

const indexConfig = {
  entry: './lib/index.js',
  mode: 'production',
  output: {
    path: path.resolve(__dirname, './public'),
    filename: './index.js'
  },
  resolve: {
    fallback: {
      zlib: false
    }
  },
  module: {
    rules: [
      {
        // three declares sideEffects: false, but examples/js scripts work by attaching to the THREE global
        test: /three[/\\]examples[/\\]js/,
        sideEffects: true
      }
    ]
  },
  plugins: [
    // fix "process is not defined" error:
    new webpack.ProvidePlugin({
      process: 'process/browser'
    }),
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer']
    }),
    new webpack.NormalModuleReplacementPlugin(
      // eslint-disable-next-line
      /viewer[\/|\\]lib[\/|\\]utils/,
      './utils.web.js'
    )
    // new BundleAnalyzerPlugin()
  ],
  externals: [
    function (req, cb) {
      if (req.context.includes('minecraft-data') && req.request.endsWith('.json')) {
        const fileName = req.request.split('/').pop().replace('.json', '')
        if (blockedIndexFiles.includes(fileName) || otherVersionData(req)) {
          cb(null, [])
          return
        }
      }
      cb()
    }
  ]
}

const workerConfig = {
  entry: './viewer/lib/worker.js',
  mode: 'production',
  output: {
    path: path.join(__dirname, '/public'),
    filename: './worker.js'
  },
  resolve: {
    fallback: {
      zlib: false
    }
  },
  plugins: [
    // fix "process is not defined" error:
    new webpack.ProvidePlugin({
      process: 'process/browser'
    }),
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer']
    })
  ],
  externals: [
    function (req, cb) {
      if (req.context.includes('minecraft-data') && req.request.endsWith('.json')) {
        const fileName = req.request.split('/').pop().replace('.json', '')
        if (!allowedWorkerFiles.includes(fileName) || otherVersionData(req)) {
          cb(null, [])
          return
        }
      }
      cb()
    }
  ]
}

module.exports = [indexConfig, workerConfig]
