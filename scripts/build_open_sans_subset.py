"""Make static/fonts/open-sans/OpenSans-latin-greek.woff2 (see static/fonts/open-sans/NOTICE.md).

Run in a directory holding OpenSans-VF.ttf (googlefonts/opensans, fonts/variable/OpenSans[wdth,wght].ttf) with fontTools and brotli
installed; it writes OpenSans-latin-greek.woff2 there and prints the wanted characters the font does not have.
"""
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset
f = TTFont("OpenSans-VF.ttf")
f = instancer.instantiateVariableFont(f, {"wdth": 100, "wght": (400, 700)})
f.save("OpenSans-wght.ttf")
want = set(range(0x20, 0x7F)) | set(range(0xA0, 0x100)) | set(range(0x100, 0x180)) | set(range(0x370, 0x400)) | set(range(0x2000, 0x2070)) \
    | {0x2212, 0x00B1, 0x2265, 0x2264, 0x00D7, 0x00F7, 0x03A3, 0x0394, 0x03C3, 0x03BC, 0x0304, 0x2039, 0x203A, 0x207A, 0x0025, 0x2192, 0x2713, 0x2264, 0x2260, 0x221E, 0x2248, 0x2191, 0x2193, 0x2022, 0x2026, 0x20AC}
opts = subset.Options(); opts.flavor = "woff2"; opts.layout_features = ["*"]; opts.notdef_outline = True; opts.name_IDs = ["*"]; opts.drop_tables += ["DSIG"]
ft = TTFont("OpenSans-wght.ttf")
sub = subset.Subsetter(opts); sub.populate(unicodes=sorted(want)); sub.subset(ft)
ft.flavor = "woff2"; ft.save("OpenSans-latin-greek.woff2")
cmap = TTFont("OpenSans-latin-greek.woff2").getBestCmap()
miss = sorted(hex(u) + " " + chr(u) for u in want if u not in cmap and u > 0x20)
print("missing from the font:", miss)
