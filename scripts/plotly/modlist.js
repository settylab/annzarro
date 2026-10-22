// Prints the npm packages webpack puts into the annzarro Plotly bundle, one name@version per line.
// Run by scripts/build-plotly-bundle.sh from inside the plotly.js checkout (after the bundle
// build, so lib/index-annzarro.js exists): node modlist.js <plotly.js checkout> <scratch output dir>
// Not part of the bundle; only feeds scripts/plotly_licences.py.
const path = require('path');
const webpack = require('webpack');

const root = path.resolve(process.argv[2]);
process.chdir(root);
const config = require(path.join(root, 'webpack.config.js'));
config.module.rules.push({ test: /\.js$/, use: ['transform-loader?' + path.join(root, 'tasks/compress_attributes.js')] });
config.entry = path.join(root, 'lib/index-annzarro.js');
config.output.path = path.resolve(process.argv[3]);
config.output.filename = 'modlist.js';
config.optimization = { minimize: false };

webpack(config).run((err, stats) => {
  if (err) throw err;
  const found = new Set();
  const walk = (modules) => modules.forEach((m) => {
    const file = String(m.resource || (m.identifier && m.identifier()) || '');
    const hit = file.match(/^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//);
    if (hit) {
      try { found.add(hit[2] + '@' + require(path.join(hit[1], 'package.json')).version); } catch (e) { /* nested fixture */ }
    }
    if (m.modules) walk(m.modules);
  });
  walk(stats.compilation.modules);
  console.log([...found].sort().join('\n'));
});
