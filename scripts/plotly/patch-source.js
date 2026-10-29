// Patches the plotly.js source before scripts/build-plotly-bundle.sh bundles it:
//   node patch-source.js <plotly.js checkout>
//
// One WebGL context per 2D scattergl graph, not two. plotly.js makes a regl (a WebGL context) for
// every gl canvas that is not the pick layer: the context layer and the focus layer. The focus
// layer has one user, scattergl's selection drawing (select2d: box and lasso selection, and
// selectedpoints), which AnnZarro never uses (its modebar has no select tools). Safari allows
// about 16 live WebGL contexts and keeps a released context in the count until it is garbage
// collected, so with two per graph the plots on screen lost their contexts after a few panels were
// opened and closed. With the focus regl missing, selection (if it is ever used) draws on the
// context layer.
//
// Each replacement must match exactly once; a plotly.js upgrade that moves the code fails the
// build instead of quietly shipping the unpatched file.
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2]);

function patch(file, from, to) {
    const p = path.join(root, file);
    const src = fs.readFileSync(p, 'utf8');
    const n = src.split(from).length - 1;
    if (n !== 1) {
        console.error(`patch-source: ${file}: expected exactly one match of\n  ${from}\nfound ${n}`);
        process.exit(1);
    }
    fs.writeFileSync(p, src.replace(from, () => to));
    console.log(`patched ${file}`);
}

patch('src/lib/prepare_regl.js',
    "if(d.pick && !fullLayout._has('parcoords')) return;",
    "if((d.pick && !fullLayout._has('parcoords')) || d.key === 'focusLayer') return;");

patch('src/traces/scattergl/plot.js',
    'scene.select2d = createScatter(fullLayout._glcanvas.data()[1].regl);',
    'scene.select2d = createScatter(fullLayout._glcanvas.data()[1].regl || fullLayout._glcanvas.data()[0].regl);');
