/**
 * Generates an array of `n` colors based on a specified colormap or strategy.
 * 
 * The function supports:
 * - Named discrete colormaps (e.g., 'Set1', 'Set2', etc.).
 * - Sampling from continuous colormaps (e.g., 'YlGnBu', 'Spectral', etc.).
 * - Hue interpolation for evenly spaced colors in HSL format (using 'hue').
 * - Custom single-color schemes (e.g., '#RRGGBB', 'hsl()', or 'rgb()').
 * - Custom colormap functions that generate colors dynamically.
 * 
 * If the requested number of colors exceeds the available colors in a discrete colormap,
 * the colors will be recycled to fulfill the request.
 * 
 * @param {number} n - Number of colors to generate.
 * @param {string|function} [colormap='tab10'] - Name of the colormap, a custom color string, or a function to generate colors.
 * @param {boolean} [reverse=false] - Whether to reverse the colormap.
 * @returns {string[]} Array of colors in hex, HSL, or RGB format.
 * @throws {Error} If the colormap is unknown or invalid.
 */
export function generateDiscreteColors(n, colormap = 'tab10', reverse = false) {
    // Automatically reverse if colormap ends with "_r"
    if (typeof colormap === "string" && colormap.endsWith("_r")) {
        reverse = !reverse;
    }

    const interpolateColor = (color1, color2, t) => {
        const c1 = parseInt(color1.slice(1), 16);
        const c2 = parseInt(color2.slice(1), 16);
    
        const r1 = (c1 >> 16) & 0xff;
        const g1 = (c1 >> 8) & 0xff;
        const b1 = c1 & 0xff;
    
        const r2 = (c2 >> 16) & 0xff;
        const g2 = (c2 >> 8) & 0xff;
        const b2 = c2 & 0xff;
    
        const r = Math.round(r1 + (r2 - r1) * t);
        const g = Math.round(g1 + (g2 - g1) * t);
        const b = Math.round(b1 + (b2 - b1) * t);
    
        return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    };

    const sampleContinuous = (colormapName, n) => {
        const scale = continuousColormaps[colormapName];
        if (!scale) throw new Error(`Unknown continuous colormap: ${colormapName}`);
        const result = [];
        const steps = scale.length - 1;
        for (let i = 0; i < n; i++) {
          const t = (i * steps) / (n - 1);
          const low = Math.floor(t);
          const high = Math.ceil(t);
          const frac = t - low;
          result.push(interpolateColor(scale[low], scale[high], frac));
        }
        return result;
    };

    const generateHue = (n) => {
        const colors = [];
        if (n <= 0) return colors;
        for (let i = 0; i < n; i++) {
          const h = (i * 360) / n;
          colors.push(`hsl(${h}, 65%, 55%)`);
        }
        return colors;
    };
  
    const colormapData = discreteColormaps[colormap];
    if (colormapData) {
        let colors = n <= colormapData.length
            ? colormapData.slice(0, n)
            : Array.from({ length: n }, (_, i) => colormapData[i % colormapData.length]);
        return reverse ? colors.reverse() : colors;
    }

    if (continuousColormaps[colormap]) {
        let colors = sampleContinuous(colormap, n);
        return reverse ? colors.reverse() : colors;
    }

    if (colormap === "hue") {
        let colors = generateHue(n);
        return reverse ? colors.reverse() : colors;
    }

    // Handle case where colormap is a function
    if (typeof colormap === "function") {
      return colormap(n);
    }
    // Handle case where colormap is a string but not in the known lists
    if (colormap.startsWith("#")) {
      return Array(n).fill(colormap);
    }

    if (typeof colormap === "string" && colormap.startsWith("chroma:")) {
        const scaleName = colormap.replace("chroma:", "");
        if (typeof chroma !== "undefined" && chroma.brewer[scaleName]) {
            const scale = chroma.scale(chroma.brewer[scaleName]).mode("lab");
            let colors = scale.colors(n);
            return reverse ? colors.reverse() : colors;
        } else {
            throw new Error(`Unknown Chroma.js colormap: ${scaleName}`);
        }
    }
    throw new Error(`Unknown colormap: ${colormap}`);
  }

/**
 * Lists all available colormaps grouped by type.
 *
 * @returns {Object} An object with keys as group labels and values as arrays of colormap names.
 */
export function listAvailableColormaps() {
    let chromaColormaps = [];
    try {
      if (typeof chroma !== 'undefined' && chroma.brewer) {
        chromaColormaps = Object.keys(chroma.brewer).map(name => `chroma:${name}`);
      }
    } catch (e) {
      console.warn("Chroma.js not loaded, skipping chroma colormaps.");
    }
  
    return {
      'Discrete Palettes': Object.keys(discreteColormaps),
      'Continuous Palettes': Object.keys(continuousColormaps),
      'Chroma Palettes': chromaColormaps,
      'Custom': ['hue']
    };
  }

const discreteColormaps = {
    // Qualitative
    Accent: ['#7fc97f', '#beaed4', '#fdc086', '#ffff99', '#386cb0', '#f0027f', '#bf5b17', '#666666'],
    Dark2: ['#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e', '#e6ab02', '#a6761d', '#666666'],
    Paired: ['#a6cee3', '#1f78b4', '#b2df8a', '#33a02c', '#fb9a99', '#e31a1c', '#fdbf6f', '#ff7f00', '#cab2d6', '#6a3d9a', '#ffff99', '#b15928'],
    Pastel1: ['#fbb4ae', '#b3cde3', '#ccebc5', '#decbe4', '#fed9a6', '#ffffcc', '#e5d8bd', '#fddaec', '#f2f2f2'],
    Pastel2: ['#b3e2cd', '#fdcdac', '#cbd5e8', '#f4cae4', '#e6f5c9', '#fff2ae', '#f1e2cc', '#cccccc'],
    Set1: ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00', '#ffff33', '#a65628', '#f781bf', '#999999'],
    Set2: ['#66c2a5', '#fc8d62', '#8da0cb', '#e78ac3', '#a6d854', '#ffd92f', '#e5c494', '#b3b3b3'],
    Set3: ['#8dd3c7', '#ffffb3', '#bebada', '#fb8072', '#80b1d3', '#fdb462', '#b3de69', '#fccde5', '#d9d9d9', '#bc80bd', '#ccebc5', '#ffed6f'],
    tab10: ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'],
    tab20: ['#1f77b4', '#aec7e8', '#ff7f0e', '#ffbb78', '#2ca02c', '#98df8a', '#d62728', '#ff9896', '#9467bd', '#c5b0d5', '#8c564b', '#c49c94', '#e377c2', '#f7b6d2', '#7f7f7f', '#c7c7c7', '#bcbd22', '#dbdb8d', '#17becf', '#9edae5'],
    tab20b: ['#393b79', '#5254a3', '#6b6ecf', '#9c9ede', '#637939', '#8ca252', '#b5cf6b', '#cedb9c', '#8c6d31', '#bd9e39', '#e7ba52', '#e7cb94', '#843c39', '#ad494a', '#d6616b', '#e7969c', '#7b4173', '#a55194', '#ce6dbd', '#de9ed6'],
    tab20c: ['#3182bd', '#6baed6', '#9ecae1', '#c6dbef', '#e6550d', '#fd8d3c', '#fdae6b', '#fdd0a2', '#31a354', '#74c476', '#a1d99b', '#c7e9c0', '#756bb1', '#9e9ac8', '#bcbddc', '#dadaeb', '#636363', '#969696', '#bdbdbd', '#d9d9d9'],

    // HEAVY.AI inspired palettes
    RetroMetro: ["#ea5545", "#f46a9b", "#ef9b20", "#edbf33", "#ede15b", "#bdcf32", "#87bc45", "#27aeef", "#b33dc6"],
    DutchField: ["#e60049", "#0bb4ff", "#50e991", "#e6d800", "#9b19f5", "#ffa300", "#dc0ab4", "#b3d4ff", "#00bfa0"],
    RiverNights: ["#b30000", "#7c1158", "#4421af", "#1a53ff", "#0d88e6", "#00b7c7", "#5ad45a", "#8be04e", "#ebdc78"],
    SpringPastels: ["#fd7f6f", "#7eb0d5", "#b2e061", "#bd7ebe", "#ffb55a", "#ffee65", "#beb9db", "#fdcce5", "#8bd3c7"],

    // Modern palettes
    Tableau10: [
        '#4e79a7', // blue
        '#f28e2b', // orange
        '#e15759', // red
        '#76b7b2', // teal
        '#59a14f', // green
        '#edc949', // yellow
        '#af7aa1', // purple
        '#ff9da7', // pink
        '#9c755f', // brown
        '#bab0ac'  // gray
    ],
    Plotly: [
        '#1f77b4', // muted blue
        '#ff7f0e', // safety orange
        '#2ca02c', // cooked asparagus green
        '#d62728', // brick red
        '#9467bd', // muted purple
        '#8c564b', // chestnut brown
        '#e377c2', // raspberry yogurt pink
        '#7f7f7f', // middle gray
        '#bcbd22', // curry yellow-green
        '#17becf'  // blue-teal
    ]
  };

  const continuousColormaps = {
    Blues: ['#f7fbff', '#eaf3fb', '#deebf7', '#d2e3f3', '#c6dbef', '#b2d2e8', '#9dcae1', '#84bcdb', '#6aaed6', '#56a0ce', '#4191c6', '#3181bd', '#2070b4', '#1460a8', '#08509b', '#084082', '#08306b'],
    BrBG: ['#543005', '#774508', '#995d13', '#b97b29', '#cfa256', '#e2c787', '#f1dfb3', '#f6edd7', '#f4f5f5', '#d7eeeb', '#b4e2db', '#87d0c5', '#58b0a7', '#2d8f87', '#0c7169', '#01554b', '#003c30'],
    BuGn: ['#f7fcfd', '#eef8fb', '#e5f5f9', '#d8f0ef', '#ccece6', '#b2e2d7', '#98d8c9', '#7fcdb6', '#65c2a3', '#53b88c', '#40ad75', '#319c5c', '#228a44', '#117b38', '#006c2c', '#005723', '#00441b'],
    BuPu: ['#f7fcfd', '#ebf4f8', '#e0ecf4', '#cfdfed', '#bfd3e6', '#aec7e0', '#9ebcda', '#95a8d0', '#8c95c6', '#8c80bb', '#8c6ab1', '#8a55a7', '#88409c', '#84278c', '#800f7b', '#650762', '#4d004b'],
    CMRmap: ['#000000', '#131340', '#262680', '#3a26a0', '#4d26bf', '#732d9f', '#9a337e', '#cd3a52', '#ff4126', '#f26112', '#e68100', '#e6a10d', '#e6c01c', '#e6d34f', '#e6e683', '#f3f3c3', '#ffffff'],
    GnBu: ['#f7fcf0', '#ebf7e5', '#e0f3db', '#d6efd0', '#ccebc5', '#bae4bd', '#a7ddb5', '#91d4bd', '#7accc4', '#64bfcc', '#4db2d3', '#3c9fc8', '#2a8bbe', '#1979b5', '#0867ab', '#085395', '#084081'],
    Grays: ['#ffffff', '#f7f7f7', '#f0f0f0', '#e4e4e4', '#d9d9d9', '#cbcbcb', '#bdbdbd', '#a9a9a9', '#959595', '#848484', '#727272', '#626262', '#515151', '#3a3a3a', '#242424', '#111111', '#000000'],
    Greens: ['#f7fcf5', '#eef8ea', '#e5f5e0', '#d6efd0', '#c7e9c0', '#b4e1ad', '#a0d99b', '#8ace88', '#73c476', '#5ab769', '#40aa5d', '#319a50', '#228a44', '#117b38', '#006c2c', '#005723', '#00441b'],
    Greys: ['#ffffff', '#f7f7f7', '#f0f0f0', '#e4e4e4', '#d9d9d9', '#cbcbcb', '#bdbdbd', '#a9a9a9', '#959595', '#848484', '#727272', '#626262', '#515151', '#3a3a3a', '#242424', '#111111', '#000000'],
    OrRd: ['#fff7ec', '#feefda', '#fee8c8', '#fddeb3', '#fdd49e', '#fdc791', '#fdba83', '#fca36e', '#fc8c59', '#f57850', '#ef6447', '#e24933', '#d62f1e', '#c4170f', '#b20000', '#970000', '#7f0000'],
    Oranges: ['#fff5eb', '#feeddc', '#fee6ce', '#fddbb8', '#fdd0a2', '#fdbf86', '#fdae6a', '#fd9d53', '#fd8c3b', '#f77a27', '#f16813', '#e4580a', '#d84801', '#be3f02', '#a53603', '#912e04', '#7f2704'],
    PRGn: ['#40004b', '#621a6e', '#7f3c8d', '#9568a6', '#ae8bbd', '#c7abd2', '#dec9e2', '#ede2ee', '#f6f7f6', '#e4f2e0', '#cbeac5', '#abdda5', '#7ec37f', '#50a65a', '#298440', '#10632b', '#00441b'],
    PiYG: ['#8e0152', '#b1116d', '#cb3289', '#db6ca8', '#e897c4', '#f3bcdd', '#fad6ea', '#fbe9f2', '#f7f7f6', '#ecf6de', '#d9f0bc', '#bde38d', '#9acd61', '#77b53c', '#589b28', '#3d7f1e', '#276419'],
    PuBu: ['#fff7fb', '#f5eff6', '#ece7f2', '#dedcec', '#d0d1e6', '#bbc7e0', '#a5bddb', '#8cb3d5', '#73a9cf', '#549cc7', '#358fc0', '#1c7fb8', '#056faf', '#04649e', '#04598c', '#034871', '#023858'],
    PuBuGn: ['#fff7fb', '#f5ecf5', '#ece2f0', '#ded9eb', '#d0d1e6', '#bbc7e0', '#a5bddb', '#86b3d5', '#66a9cf', '#4e9cc7', '#3590bf', '#1b88a4', '#028189', '#017670', '#016b58', '#015846', '#014636'],
    PuOr: ['#7f3b08', '#a04d07', '#be630a', '#db7d12', '#ef9e3c', '#fdbd6e', '#fed7a2', '#fbe9cf', '#f6f6f7', '#e3e4ef', '#cecde4', '#b6b0d4', '#988dbe', '#7967a6', '#5d3790', '#44176f', '#2d004b'],
    PuRd: ['#f7f4f9', '#efeaf4', '#e7e1ef', '#ddcde4', '#d4b9da', '#cea6d0', '#c993c7', '#d47cbb', '#df64af', '#e3469c', '#e72989', '#da1d6f', '#cd1256', '#b2094c', '#970042', '#7e0030', '#67001f'],
    Purples: ['#fcfbfd', '#f5f4f9', '#efedf5', '#e4e3f0', '#dadaeb', '#cbcbe3', '#bcbddc', '#adabd2', '#9e9ac8', '#8e8bc1', '#807cba', '#7566ae', '#6950a3', '#5e3b98', '#53268f', '#491285', '#3f007d'],
    RdBu: ['#67001f', '#960f27', '#bb2a34', '#d25849', '#e58368', '#f5ac8b', '#fbceb7', '#fbe6da', '#f6f7f7', '#deebf2', '#c0dceb', '#98c8e0', '#68abd0', '#3e8cbf', '#2870b1', '#15508d', '#053061'],
    RdGy: ['#67001f', '#960f27', '#bb2a34', '#d25849', '#e58368', '#f5ac8b', '#fbceb7', '#fee9dd', '#fefefe', '#ebebeb', '#d6d6d6', '#bebebe', '#9f9f9f', '#7e7e7e', '#5a5a5a', '#383838', '#1a1a1a'],
    RdPu: ['#fff7f3', '#feebe8', '#fde0dd', '#fcd2ce', '#fcc5c0', '#fbb2ba', '#fa9eb5', '#f883ab', '#f767a1', '#ea4d9c', '#dc3397', '#c4198a', '#ad017e', '#93017a', '#790177', '#600070', '#49006a'],
    RdYlBu: ['#a50026', '#c41e27', '#de402e', '#f16640', '#f98e52', '#fdb567', '#fed485', '#feeca2', '#feffc0', '#ebf7e4', '#d1ecf4', '#b0dcea', '#8ec2dc', '#6da4cc', '#4f81ba', '#3d5ba7', '#313695'],
    RdYlGn: ['#a50026', '#c41e27', '#de402e', '#f16640', '#f98e52', '#fdb567', '#fed481', '#feec9f', '#feffbe', '#e6f59d', '#cbe982', '#abdb6d', '#84ca66', '#5ab760', '#2aa054', '#0f8446', '#006837'],
    Reds: ['#fff5f0', '#feeae1', '#fee0d2', '#fdcdb9', '#fcbba1', '#fca689', '#fc9272', '#fb7d5d', '#fb694a', '#f5523a', '#ee3a2c', '#dc2924', '#ca181d', '#b71319', '#a30f15', '#840711', '#67000d'],
    Spectral: ['#9e0142', '#c1274a', '#dd4a4c', '#f06744', '#f98e52', '#fdb567', '#fed481', '#feec9f', '#ffffbe', '#eff9a6', '#d6ee9b', '#b1dfa3', '#86cfa5', '#5eb9a9', '#3d95b8', '#4471b2', '#5e4fa2'],
    Wistia: ['#e4ff7a', '#ebf962', '#f2f34a', '#f8ee32', '#ffe81a', '#ffdd13', '#ffd20d', '#ffc706', '#ffbd00', '#ffb500', '#ffae00', '#ffa700', '#ffa000', '#fe9700', '#fd8f00', '#fd8700', '#fc7f00'],
    YlGn: ['#ffffe5', '#fbfdcf', '#f7fcb9', '#e8f6ae', '#d9f0a3', '#c3e698', '#acdd8e', '#92d183', '#77c679', '#5cb86b', '#40aa5c', '#31974f', '#228343', '#11753d', '#006737', '#005530', '#004529'],
    YlGnBu: ['#ffffd9', '#f6fbc5', '#edf8b1', '#daf0b3', '#c6e9b4', '#a2dbb8', '#7ecdbb', '#5fc1c0', '#40b5c4', '#2ea3c2', '#1d90c0', '#2076b3', '#225da8', '#24489d', '#243392', '#162874', '#081d58'],
    YlOrBr: ['#ffffe5', '#fffbd0', '#fff7bc', '#feeda6', '#fee390', '#fed36f', '#fec34f', '#feae3b', '#fe9829', '#f5841e', '#eb6f14', '#db5d0b', '#cb4b02', '#b13f03', '#983404', '#7e2c05', '#662506'],
    YlOrRd: ['#ffffcc', '#fff6b6', '#ffeda0', '#fee38b', '#fed976', '#fec561', '#feb24c', '#fd9f44', '#fd8c3c', '#fc6c33', '#fc4d2a', '#ef3323', '#e2191c', '#cf0c21', '#bb0026', '#9d0026', '#800026'],
    afmhot: ['#000000', '#200000', '#400000', '#600000', '#800000', '#a02000', '#c04000', '#e06000', '#ff8001', '#ffa021', '#ffc041', '#ffe061', '#ffff81', '#ffffa1', '#ffffc1', '#ffffe1', '#ffffff'],
    autumn: ['#ff0000', '#ff1000', '#ff2000', '#ff3000', '#ff4000', '#ff5000', '#ff6000', '#ff7000', '#ff8000', '#ff9000', '#ffa000', '#ffb000', '#ffc000', '#ffd000', '#ffe000', '#fff000', '#ffff00'],
    berlin: ['#9eb0ff', '#79abed', '#519fd3', '#3685ad', '#286886', '#1d4b61', '#14303e', '#111a20', '#190c09', '#2b0e01', '#411201', '#5b1d08', '#7d341e', '#9e513f', '#be6f63', '#df8f89', '#ffadad'],
    binary: ['#ffffff', '#efefef', '#dfdfdf', '#cfcfcf', '#bfbfbf', '#afafaf', '#9f9f9f', '#8f8f8f', '#7f7f7f', '#6f6f6f', '#5f5f5f', '#4f4f4f', '#3f3f3f', '#2f2f2f', '#1f1f1f', '#0f0f0f', '#000000'],
    bone: ['#000000', '#0e0e13', '#1c1c27', '#2a2a3a', '#38384e', '#464661', '#545574', '#626882', '#707b90', '#7e8f9e', '#8ca2ac', '#9ab5ba', '#a9c8c8', '#bfd6d6', '#d5e4e4', '#eaf2f2', '#ffffff'],
    brg: ['#0000ff', '#2000df', '#4000bf', '#60009f', '#80007f', '#a0005f', '#c0003f', '#e0001f', '#fe0100', '#de2100', '#be4100', '#9e6100', '#7e8100', '#5ea100', '#3ec100', '#1ee100', '#00ff00'],
    bwr: ['#0000ff', '#2020ff', '#4040ff', '#6060ff', '#8080ff', '#a0a0ff', '#c0c0ff', '#e0e0ff', '#fffefe', '#ffdede', '#ffbebe', '#ff9e9e', '#ff7e7e', '#ff5e5e', '#ff3e3e', '#ff1e1e', '#ff0000'],
    cividis: ['#00224e', '#002e6a', '#1a386f', '#32436d', '#434e6c', '#535a6d', '#61656f', '#6f7073', '#7d7c78', '#8c8878', '#9b9476', '#aba072', '#bcae6c', '#cdbb63', '#dec958', '#f0d846', '#fee838'],
    cool: ['#00ffff', '#10efff', '#20dfff', '#30cfff', '#40bfff', '#50afff', '#609fff', '#708fff', '#807fff', '#906fff', '#a05fff', '#b04fff', '#c03fff', '#d02fff', '#e01fff', '#f00fff', '#ff00ff'],
    coolwarm: ['#3b4cc0', '#4e68d8', '#6282ea', '#779af7', '#8db0fe', '#a3c2fe', '#b9d0f9', '#ccd9ed', '#dddcdc', '#ecd3c5', '#f5c4ac', '#f7b093', '#f4987a', '#eb7d62', '#dd5f4b', '#ca3b37', '#b40426'],
    copper: ['#000000', '#140c08', '#281910', '#3b2518', '#4f3220', '#633e28', '#774b30', '#8a5738', '#9e6440', '#b27048', '#c67d50', '#d98958', '#ed9660', '#ffa267', '#ffaf6f', '#ffbb77', '#ffc77f'],
    crest: ['#a5cd90', '#93c491', '#81bc91', '#70b390', '#61aa90', '#53a190', '#48988f', '#3e8e8e', '#33858d', '#297b8c', '#20728b', '#1c6889', '#1e5d86', '#225283', '#27477d', '#2a3c77', '#2c3172'],
    cubehelix: ['#000000', '#150b1d', '#1b1e3b', '#17374d', '#16534c', '#236a3e', '#447731', '#727b32', '#a1794a', '#c57a76', '#d484a9', '#d198d4', '#c6b4ee', '#c1d1f3', '#cbe8f0', '#e3f6f0', '#ffffff'],
    flag: ['#ff0000', '#fc0000', '#f10000', '#e60000', '#d90000', '#cd0000', '#c00000', '#b20000', '#a40000', '#960000', '#880000', '#7a0000', '#6c0000', '#5e0000', '#500000', '#430000', '#000000'],
    flare: ['#edb081', '#eca077', '#ea916e', '#e88165', '#e5715e', '#e0615c', '#d9535d', '#cf4862', '#c14168', '#b23c6c', '#a3386f', '#943470', '#863071', '#762d6f', '#672a6b', '#582766', '#4b2362'],
    gist_earth: ['#000000', '#0b1575', '#153978', '#20597b', '#2b737e', '#348576', '#3b8e62', '#43974f', '#5ea04b', '#7fa853', '#99af58', '#b4b65d', '#bdab62', '#c8a779', '#dab7a0', '#ecd3ce', '#fdfbfb'],
    gist_gray: ['#000000', '#101010', '#202020', '#303030', '#404040', '#505050', '#606060', '#707070', '#808080', '#909090', '#a0a0a0', '#b0b0b0', '#c0c0c0', '#d0d0d0', '#e0e0e0', '#f0f0f0', '#ffffff'],
    gist_grey: ['#000000', '#101010', '#202020', '#303030', '#404040', '#505050', '#606060', '#707070', '#808080', '#909090', '#a0a0a0', '#b0b0b0', '#c0c0c0', '#d0d0d0', '#e0e0e0', '#f0f0f0', '#ffffff'],
    gist_heat: ['#000000', '#180000', '#300000', '#480000', '#600000', '#780000', '#900000', '#a80000', '#c00100', '#d82100', '#f04100', '#ff6100', '#ff8103', '#ffa143', '#ffc183', '#ffe1c3', '#ffffff'],
    gist_ncar: ['#000080', '#004b37', '#0047ff', '#00e0ff', '#00fbb0', '#06ff15', '#68d500', '#92ff18', '#dbff20', '#ffe400', '#ffbc0d', '#ff4300', '#ff0047', '#d615ff', '#ce62f4', '#f3b3f5', '#fef8fe'],
    gist_rainbow: ['#ff0029', '#ff2d00', '#ff8400', '#ffda00', '#cdff00', '#77ff00', '#20ff00', '#00ff36', '#00ff8c', '#00ffe2', '#00c6ff', '#006fff', '#0018ff', '#3f00ff', '#9600ff', '#ed00ff', '#ff00bf'],
    gist_stern: ['#000000', '#f51020', '#a52040', '#553060', '#404080', '#5050a0', '#6060c0', '#7070e0', '#8080fd', '#9090b9', '#a0a075', '#b0b031', '#c0c011', '#d0d04e', '#e0e08a', '#f0f0c6', '#ffffff'],
    gist_yarg: ['#ffffff', '#efefef', '#dfdfdf', '#cfcfcf', '#bfbfbf', '#afafaf', '#9f9f9f', '#8f8f8f', '#7f7f7f', '#6f6f6f', '#5f5f5f', '#4f4f4f', '#3f3f3f', '#2f2f2f', '#1f1f1f', '#0f0f0f', '#000000'],
    gist_yerg: ['#ffffff', '#efefef', '#dfdfdf', '#cfcfcf', '#bfbfbf', '#afafaf', '#9f9f9f', '#8f8f8f', '#7f7f7f', '#6f6f6f', '#5f5f5f', '#4f4f4f', '#3f3f3f', '#2f2f2f', '#1f1f1f', '#0f0f0f', '#000000'],
    gnuplot: ['#000000', '#400062', '#5a01b5', '#6f02ec', '#8004ff', '#8f08eb', '#9c0eb3', '#a9165f', '#b52000', '#c02e00', '#ca3f00', '#d45400', '#dd6d00', '#e68a00', '#efad00', '#f7d500', '#ffff00'],
    gnuplot2: ['#000000', '#000040', '#000080', '#0000c0', '#0100ff', '#3300ff', '#6500ff', '#970af5', '#c92ad5', '#fb4ab5', '#ff6a95', '#ff8a75', '#ffaa55', '#ffca35', '#ffea15', '#ffff43', '#ffffff'],
    gray: ['#000000', '#101010', '#202020', '#303030', '#404040', '#505050', '#606060', '#707070', '#808080', '#909090', '#a0a0a0', '#b0b0b0', '#c0c0c0', '#d0d0d0', '#e0e0e0', '#f0f0f0', '#ffffff'],
    grey: ['#000000', '#101010', '#202020', '#303030', '#404040', '#505050', '#606060', '#707070', '#808080', '#909090', '#a0a0a0', '#b0b0b0', '#c0c0c0', '#d0d0d0', '#e0e0e0', '#f0f0f0', '#ffffff'],
    hot: ['#0b0000', '#350000', '#5f0000', '#890000', '#b30000', '#dd0000', '#ff0800', '#ff3200', '#ff5c00', '#ff8600', '#ffb000', '#ffda00', '#ffff07', '#ffff46', '#ffff85', '#ffffc4', '#ffffff'],
    hsv: ['#ff0000', '#ff5f00', '#ffbd00', '#e2ff00', '#84ff00', '#25ff00', '#00ff39', '#00ff97', '#00fff6', '#00aaff', '#004bff', '#1300ff', '#7200ff', '#d000ff', '#ff00cf', '#ff0071', '#ff0018'],
    icefire: ['#bde7db', '#90c8d1', '#60abcd', '#3c8ccf', '#4167c7', '#484996', '#37355c', '#252532', '#1f1e1e', '#372025', '#5c2935', '#8a2e43', '#b93540', '#da5334', '#ed7e40', '#f7ab75', '#ffd4ac'],
    inferno: ['#000004', '#0b0724', '#210c4a', '#3d0965', '#57106e', '#71196e', '#8a226a', '#a32c61', '#bc3754', '#d24644', '#e45a31', '#f1731d', '#f98e09', '#fcac11', '#f9cb35', '#f2ea69', '#fcffa4'],
    jet: ['#000080', '#0000c8', '#0000ff', '#0040ff', '#0080ff', '#00c0ff', '#16ffe1', '#49ffad', '#7dff7a', '#b1ff46', '#e4ff13', '#ffd000', '#ff9400', '#ff5900', '#ff1e00', '#c40000', '#800000'],
    magma: ['#000004', '#0a0822', '#1d1147', '#36106b', '#51127c', '#6a1c81', '#832681', '#9c2e7f', '#b73779', '#d0416f', '#e75263', '#f56b5c', '#fc8961', '#fea772', '#fec488', '#fde2a3', '#fcfdbf'],
    mako: ['#0b0405', '#1c101c', '#2b1c35', '#37284f', '#3e356b', '#414387', '#3b5698', '#36699f', '#357ba3', '#348da7', '#359fab', '#3cb1ad', '#4bc2ad', '#6ad2ad', '#99ddb6', '#c0e9cc', '#def5e5'],
    managua: ['#ffcf67', '#ebb05d', '#d89353', '#c5794a', '#b16243', '#9a4c3d', '#813939', '#692b3c', '#572949', '#4e3362', '#4c4781', '#505e9d', '#5877b5', '#6190c8', '#6bacdb', '#76c9ed', '#81e7ff'],
    nipy_spectral: ['#000000', '#7b008c', '#4300a2', '#0000d1', '#0078dd', '#009ecf', '#00aa98', '#009d1d', '#00bc00', '#00e700', '#67ff00', '#e4f100', '#ffc900', '#ff6900', '#ec0000', '#cf0000', '#cccccc'],
    ocean: ['#008000', '#006810', '#005020', '#003830', '#002040', '#000850', '#001060', '#002870', '#004080', '#005890', '#0070a0', '#1288b0', '#42a0c0', '#72b9d0', '#a2d0e0', '#d2e8f0', '#ffffff'],
    pink: ['#1e0000', '#553434', '#744a4a', '#8d5a5a', '#a16868', '#b47575', '#c38280', '#ca988a', '#d0ac94', '#d7bd9c', '#ddcda5', '#e3dcad', '#e9e9b6', '#efefcb', '#f4f4de', '#fafaf0', '#ffffff'],
    plasma: ['#0d0887', '#310597', '#4c02a1', '#6600a7', '#7e03a8', '#9511a1', '#aa2395', '#bc3587', '#cc4778', '#da5a6a', '#e66c5c', '#f0804e', '#f89540', '#fdac33', '#fdc527', '#f8df25', '#f0f921'],
    prism: ['#ff0000', '#0030e9', '#f5ff00', '#ff003a', '#0057c4', '#fff100', '#f00071', '#007e96', '#ffd700', '#ca00a3', '#00a462', '#ffb800', '#a300cf', '#11c62a', '#ff9400', '#7c00f1', '#54ff00'],
    rainbow: ['#8000ff', '#6032fe', '#4062fa', '#208ef4', '#00b5eb', '#20d5e1', '#40ecd4', '#60fac5', '#80ffb4', '#a0faa1', '#c0eb8d', '#e0d377', '#ffb360', '#ff8c49', '#ff5f30', '#ff2f18', '#ff0000'],
    rocket: ['#03051a', '#180f29', '#30173a', '#481c48', '#611f53', '#7b1f59', '#971c5b', '#b21758', '#cb1b4f', '#df2f44', '#ec4c3e', '#f26b49', '#f58860', '#f6a37a', '#f6bc99', '#f8d4bc', '#faebdd'],
    seismic: ['#00004c', '#000079', '#0000a6', '#0000d3', '#0101ff', '#4141ff', '#8181ff', '#c1c1ff', '#fffdfd', '#ffbdbd', '#ff7d7d', '#ff3d3d', '#fe0000', '#de0000', '#be0000', '#9e0000', '#800000'],
    spring: ['#ff00ff', '#ff10ef', '#ff20df', '#ff30cf', '#ff40bf', '#ff50af', '#ff609f', '#ff708f', '#ff807f', '#ff906f', '#ffa05f', '#ffb04f', '#ffc03f', '#ffd02f', '#ffe01f', '#fff00f', '#ffff00'],
    summer: ['#008066', '#108866', '#209066', '#309866', '#40a066', '#50a866', '#60b066', '#70b866', '#80c066', '#90c866', '#a0d066', '#b0d866', '#c0e066', '#d0e866', '#e0f066', '#f0f866', '#ffff66'],
    terrain: ['#333399', '#1e5ec4', '#0888ee', '#00acc4', '#01cc66', '#41d973', '#81e680', '#c1f38d', '#fefe98', '#ded587', '#beac76', '#9e8365', '#815e56', '#a18781', '#c1b0ac', '#e1d9d7', '#ffffff'],
    turbo: ['#30123b', '#4040a2', '#466be3', '#4294ff', '#28bceb', '#18ddc2', '#32f298', '#6dfe62', '#a4fc3c', '#cdec34', '#eecf3a', '#fdac34', '#fb7e21', '#eb500e', '#d02f05', '#a91601', '#7a0403'],
    twilight: ['#e2d9e2', '#c4ced4', '#95b5c7', '#7297c1', '#6276ba', '#5e51ad', '#592a8f', '#45135c', '#2f1436', '#4a1342', '#741e4f', '#983550', '#b25652', '#c27c63', '#cca389', '#d8c7be', '#e2d9e2'],
    twilight_shifted: ['#301437', '#45135c', '#592a8f', '#5e51ad', '#6276ba', '#7297c1', '#95b5c7', '#c4ced4', '#e2d9e2', '#d8c7be', '#cca389', '#c27c63', '#b25652', '#983550', '#741e4f', '#4a1342', '#2f1436'],
    vanimo: ['#ffcdfd', '#e6a0dc', '#cd78bd', '#b2589f', '#923e80', '#692a5b', '#401b37', '#24141e', '#1a1513', '#1c2011', '#2a3716', '#3d551d', '#527227', '#678e32', '#7fae47', '#9ed56e', '#befda5'],
    viridis: ['#440154', '#48186a', '#472d7b', '#424086', '#3b528b', '#33638d', '#2c728e', '#26828e', '#21918c', '#1fa088', '#28ae80', '#3fbc73', '#5ec962', '#84d44b', '#addc30', '#d8e219', '#fde725'],
    vlag: ['#2369bd', '#4a7bbc', '#678bbe', '#829cc3', '#9baecb', '#b5c0d4', '#cfd4e0', '#e9e9ed', '#faf5f4', '#f3e2e0', '#e7c8c6', '#ddafad', '#d39794', '#c97f7d', '#bf6765', '#b44f4f', '#a9373b'],
    winter: ['#0000ff', '#0010f7', '#0020ef', '#0030e7', '#0040df', '#0050d7', '#0060cf', '#0070c7', '#0080bf', '#0090b7', '#00a0af', '#00b0a7', '#00c09f', '#00d097', '#00e08f', '#00f087', '#00ff80'],
  };