// Pasted and uploaded gene lists: a table of formats for the pure parser and matcher.
// Run: node --test annzarro/tests/js/gene-paste.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const M = await import(pathToFileURL(path.resolve(__dirname, "../../../static/js/utils/gene-paste.js")).href);
const { parseGeneInput, readInput, matchGenes, MAX_FILE_BYTES, DEFAULT_LIMIT } = M;

const GENES = ["CD3D", "CD4", "CD8A", "IL7R", "GATA1", "KLF1", "MARCHF1", "Cd3d-alt"];
const bytes = (arr) => new Uint8Array(arr);
const utf16le = (s) => { const b = []; b.push(0xFF, 0xFE); for (const c of s) { const k = c.charCodeAt(0); b.push(k & 255, k >> 8); } return bytes(b); };

test("lists: every separator and mixes", () => {
  const want = ["CD3D", "CD4", "CD8A"];
  const cases = {
    newline: "CD3D\nCD4\nCD8A",
    comma: "CD3D,CD4,CD8A",
    "comma space": "CD3D, CD4, CD8A",
    semicolon: "CD3D;CD4;CD8A",
    tab: "CD3D\tCD4\tCD8A",
    space: "CD3D CD4 CD8A",
    pipe: "CD3D|CD4|CD8A",
    "mixed": "CD3D, CD4;\nCD8A",
    "mixed all": "CD3D\tCD4 | CD8A;;\n\n",
    "padding": "  CD3D  \n\n  CD4 ,\tCD8A  ",
  };
  for (const [name, text] of Object.entries(cases)) {
    const r = parseGeneInput(text);
    assert.equal(r.format, "list", name);
    assert.deepEqual(r.names, want, name);
  }
});

test("lists: quotes stripped", () => {
  assert.deepEqual(parseGeneInput('"CD3D","CD4"\n\'CD8A\'').names, ["CD3D", "CD4", "CD8A"]);
  assert.deepEqual(parseGeneInput("“CD3D” ‘CD4’").names, ["CD3D", "CD4"]);
});

test("line endings: CRLF and lone CR", () => {
  assert.deepEqual(parseGeneInput("CD3D\r\nCD4\r\nCD8A\r\n").names, ["CD3D", "CD4", "CD8A"]);
  assert.deepEqual(parseGeneInput("CD3D\rCD4").names, ["CD3D", "CD4"]);
});

test("byte-order marks: UTF-8 and UTF-16, as bytes and as a text prefix", () => {
  const u8 = bytes([0xEF, 0xBB, 0xBF, ...new TextEncoder().encode("CD3D\nCD4\n")]);
  assert.deepEqual(parseGeneInput(readInput(u8).text).names, ["CD3D", "CD4"]);
  assert.deepEqual(parseGeneInput(readInput(utf16le("CD3D\r\nCD4")).text).names, ["CD3D", "CD4"]);
  assert.deepEqual(parseGeneInput("﻿CD3D\nCD4").names, ["CD3D", "CD4"]);
  // the BOM must not stick to the first name in a table header either
  const t = parseGeneInput("﻿gene,score\nCD3D,1\nCD4,2");
  assert.equal(t.table.columns[0], "gene");
});

test("empty input", () => {
  for (const t of ["", "   \n\t\n", "# only a comment\n"]) {
    const r = parseGeneInput(t);
    assert.deepEqual(r.names, [], JSON.stringify(t));
  }
  assert.equal(parseGeneInput("").empty, true);
  assert.deepEqual(readInput("").text, "");
});

test("CSV and TSV with a header: the gene column is found by name", () => {
  for (const [sep, name] of [[",", "CSV"], ["\t", "TSV"]]) {
    const text = ["gene_symbol", "log2FC", "padj"].join(sep) + "\n" + ["CD3D", "2.41", "0.001"].join(sep) + "\n" + ["CD4", "1.2", "0.02"].join(sep);
    const r = parseGeneInput(text);
    assert.equal(r.format, "table", name);
    assert.equal(r.table.header, true, name);
    assert.equal(r.table.column, 0, name);
    assert.deepEqual(r.names, ["CD3D", "CD4"], name);
    assert.deepEqual(r.table.columns, ["gene_symbol", "log2FC", "padj"], name);
  }
});

test("table: the gene column is not always the first, and can be picked", () => {
  const text = "score,symbol,padj\n2.4,CD3D,0.01\n1.1,CD4,0.2\n0.5,CD8A,0.3";
  assert.deepEqual(parseGeneInput(text).names, ["CD3D", "CD4", "CD8A"]);
  assert.deepEqual(parseGeneInput(text, { column: 0 }).names, ["2.4", "1.1", "0.5"]);
  assert.equal(parseGeneInput(text, { column: 99 }).table.column, 1, "out of range falls back to the pick");
});

test("table: the column with most dataset matches wins when no name helps", () => {
  const text = "a,b\n1,CD3D\n2,CD4\n3,CD8A";
  const r = parseGeneInput(text, { header: true, score: (v) => M.countKnown(v, GENES) });
  assert.equal(r.table.column, 1);
  assert.deepEqual(r.names, ["CD3D", "CD4", "CD8A"]);
});

test("CSV and TSV without a header", () => {
  const csv = "CD3D,2.41,0.001\nCD4,1.2,0.02\nCD8A,0.9,0.03";
  const r = parseGeneInput(csv);
  assert.equal(r.format, "table");
  assert.equal(r.table.header, false);
  assert.deepEqual(r.names, ["CD3D", "CD4", "CD8A"]);
  assert.deepEqual(r.table.columns, ["Column 1", "Column 2", "Column 3"]);
  const tsv = "CD3D\t2.41\nCD4\t1.2";
  const t = parseGeneInput(tsv);
  assert.equal(t.format, "table");
  assert.deepEqual(t.names, ["CD3D", "CD4"]);
  // header forced on or off
  assert.deepEqual(parseGeneInput(csv, { header: true }).names, ["CD4", "CD8A"]);
});

test("CSV quoting: commas and doubled quotes inside quoted cells, quoted newline", () => {
  const text = 'gene,note\n"CD3D","a, b"\n"CD4","say ""hi"""\nCD8A,"two\nlines"';
  const r = parseGeneInput(text);
  assert.equal(r.format, "table");
  assert.deepEqual(r.names, ["CD3D", "CD4", "CD8A"]);
});

test("a table can be read as a list, and a list as a table column", () => {
  const text = "gene,score\nCD3D,1\nCD4,2";
  assert.deepEqual(parseGeneInput(text, { readAs: "list" }).names, ["gene", "score", "CD3D", "1", "CD4", "2"]);
  const one = parseGeneInput("CD3D\nCD4", { readAs: "table" });
  assert.equal(one.format, "table");
  assert.deepEqual(one.names, ["CD3D", "CD4"]);
});

test("GMT: sets, picking one, name and description", () => {
  const gmt = "HALLMARK_A\thttp://x\tCD3D\tCD4\tCD8A\nHALLMARK_B\tdesc\tGATA1\tKLF1\n";
  const r = parseGeneInput(gmt);
  assert.equal(r.format, "gmt");
  assert.equal(r.sets.length, 2);
  assert.deepEqual(r.sets.map(s => s.name), ["HALLMARK_A", "HALLMARK_B"]);
  assert.deepEqual(r.names, ["CD3D", "CD4", "CD8A"]);
  assert.deepEqual(parseGeneInput(gmt, { setIndex: 1 }).names, ["GATA1", "KLF1"]);
  assert.deepEqual(parseGeneInput(gmt, { setIndex: 9 }).names, ["GATA1", "KLF1"], "clamped");
  assert.equal(parseGeneInput("MY_SET\tdesc\tCD3D\tCD4").format, "gmt", "a single set");
  assert.equal(parseGeneInput("ONE\thttp://x\tCD3D\tCD4").format, "gmt", "a single set with a link");
  assert.equal(parseGeneInput(gmt.replace(/\n/g, "\r\n")).sets.length, 2, "CRLF");
});

test("GMT by file extension even when every set has the same size", () => {
  const same = "A\td\tCD3D\tCD4\nB\td\tGATA1\tKLF1";
  assert.equal(parseGeneInput(same).format, "table");
  assert.equal(parseGeneInput(same, { fileName: "x.gmt" }).format, "gmt");
  assert.equal(parseGeneInput(same, { readAs: "gmt" }).sets.length, 2);
});

test("GRP: one per line, comments ignored, whole line is the name", () => {
  const grp = "# my set\nCD3D\nCD4\n#another\nCD8A\n";
  const r = parseGeneInput(grp);
  assert.equal(r.format, "grp");
  assert.deepEqual(r.names, ["CD3D", "CD4", "CD8A"]);
  assert.equal(parseGeneInput("CD3D\nCD4", { fileName: "s.grp" }).format, "grp");
  assert.deepEqual(parseGeneInput("CD3D\nCD4 x", { readAs: "grp" }).names, ["CD3D", "CD4 x"]);
});

test("Excel files are refused by signature and by extension", () => {
  const xlsx = bytes([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0]);
  const xls = bytes([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1]);
  for (const b of [xlsx, xls]) {
    const r = readInput(b, { fileName: "genes" });
    assert.equal(r.ok, false);
    assert.equal(r.code, "excel");
    assert.match(r.message, /Save the sheet as CSV first/);
  }
  assert.equal(readInput(new TextEncoder().encode("CD3D"), { fileName: "g.XLSX" }).code, "excel");
  assert.equal(readInput(new TextEncoder().encode("CD3D"), { fileName: "g.xls" }).code, "excel");
  assert.equal(readInput(bytes([0x1F, 0x8B, 8]), {}).code, "compressed");
  assert.equal(readInput(bytes([1, 2, 0, 0, 3, 4]), {}).code, "binary");
  assert.equal(readInput(new TextEncoder().encode("CD3D"), { fileName: "g.txt" }).ok, true);
});

test("the size cap: bytes and pasted text", () => {
  assert.equal(MAX_FILE_BYTES, 10 * 1024 * 1024);
  const big = new Uint8Array(MAX_FILE_BYTES + 1).fill(65);
  const r = readInput(big, { fileName: "x.txt" });
  assert.equal(r.ok, false);
  assert.equal(r.code, "too-big");
  assert.match(r.message, /10 MB/);
  assert.equal(readInput("A".repeat(MAX_FILE_BYTES + 1)).code, "too-big");
  assert.equal(readInput(new Uint8Array(MAX_FILE_BYTES).fill(65)).ok, true);
  assert.equal(readInput("abc", { maxBytes: 2 }).code, "too-big");
});

test("matching: exact, case, duplicates, already selected, unmatched", () => {
  const r = matchGenes(["CD3D", "cd4", "CD3D", "FOO1", "IL7R", "il7r"], { geneNames: GENES, currentGenes: ["IL7R"] });
  assert.deepEqual(r.toAdd, ["CD3D", "CD4"]);
  assert.equal(r.alreadySelected, 1);
  assert.equal(r.duplicates, 2, "a repeat, and il7r resolving to a gene already counted");
  assert.deepEqual(r.caseMatches, [{ input: "cd4", gene: "CD4" }]);
  assert.deepEqual(r.unmatched, ["FOO1"]);
  assert.equal(r.matched, 3);
  assert.equal(r.overLimit, false);
});

test("matching: Match case turns the case rule off; an exact name wins over a case fit", () => {
  const r = matchGenes(["cd3d", "Cd3d-alt"], { geneNames: GENES, matchCase: true });
  assert.deepEqual(r.toAdd, ["Cd3d-alt"]);
  assert.deepEqual(r.unmatched, ["cd3d"]);
  const e = matchGenes(["CD3D"], { geneNames: ["CD3D", "Cd3d"] });
  assert.deepEqual(e.toAdd, ["CD3D"]);
  assert.equal(e.caseMatches.length, 0);
});

test("matching: several genes fit ignoring case is unmatched and said so", () => {
  const r = matchGenes(["cd3d"], { geneNames: ["CD3D", "Cd3d"] });
  assert.deepEqual(r.toAdd, []);
  assert.deepEqual(r.ambiguous, ["cd3d"]);
  assert.deepEqual(r.unmatched, ["cd3d"]);
  assert.ok(r.warnings.some(w => w.code === "ambiguous"));
});

test("matching: by id through an id map, with the version stripped", () => {
  const idToName = new Map([["ENSG00000167286", "CD3D"]]);
  const r = matchGenes(["ENSG00000167286.7", "CD4"], { geneNames: GENES, idToName });
  assert.deepEqual(r.toAdd, ["CD3D", "CD4"]);
  assert.deepEqual(r.idMatches, [{ input: "ENSG00000167286.7", gene: "CD3D" }]);
});

test("mismatch: Ensembl ids against symbols", () => {
  const ids = Array.from({ length: 10 }, (_, i) => `ENSG0000000${String(1000 + i)}`);
  const r = matchGenes(ids, { geneNames: GENES });
  assert.equal(r.toAdd.length, 0);
  assert.equal(r.unmatched.length, 10);
  const w = r.warnings.find(x => x.code === "ensembl");
  assert.match(w.text, /look like Ensembl ids/);
  // with an id column there is no such message
  assert.equal(matchGenes(ids, { geneNames: GENES, idToName: new Map() }).warnings.some(x => x.code === "ensembl"), false);
  // ids against a dataset of ids is not a mismatch
  const ensGenes = ids.slice();
  assert.equal(matchGenes(["ENSG00000009999"], { geneNames: ensGenes }).warnings.some(x => x.code === "ensembl"), false);
});

test("mismatch: mouse casing against human, and Excel dates", () => {
  const r = matchGenes(["Cd3d", "Cd4", "Cd8a", "Il7r"], { geneNames: GENES });
  assert.equal(r.toAdd.length, 4);
  assert.equal(r.caseMatches.length, 4);
  assert.ok(r.warnings.some(w => w.code === "species" && /another species/.test(w.text)));
  const d = matchGenes(["1-Mar", "Sep-02", "CD4"], { geneNames: GENES });
  assert.deepEqual(d.unmatched, ["1-Mar", "Sep-02"]);
  assert.ok(d.warnings.some(w => w.code === "excel-date" && /changed by Excel/.test(w.text)));
  assert.equal(M.looksLikeExcelDate("1-Mar"), true);
  assert.equal(M.looksLikeExcelDate("MARCHF1"), false);
});

test("over the limit: flagged, never trimmed", () => {
  const names = Array.from({ length: 2431 }, (_, i) => `G${i}`);
  const r = matchGenes(names, { geneNames: names });
  assert.equal(DEFAULT_LIMIT, 2000);
  assert.equal(r.toAdd.length, 2431);
  assert.equal(r.overLimit, true);
  assert.equal(r.limit, 2000);
  // the selected genes count against the limit
  const cur = Array.from({ length: 1990 }, (_, i) => `C${i}`);
  const a = matchGenes(["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11"], { geneNames: names, currentGenes: cur });
  assert.equal(a.resulting, 2001);
  assert.equal(a.overLimit, true);
  assert.equal(matchGenes(["G1"], { geneNames: names, currentGenes: cur, limit: 5000 }).overLimit, false);
});

test("a large paste parses and matches quickly", () => {
  const genes = Array.from({ length: 60000 }, (_, i) => `GENE${i}`);
  const text = genes.slice(0, 50000).join("\n");
  const t0 = Date.now();
  const r = matchGenes(parseGeneInput(text).names, { geneNames: genes, limit: 1e6 });
  assert.equal(r.toAdd.length, 50000);
  assert.ok(Date.now() - t0 < 2000);
});

test("table: a named column the dataset knows beats an earlier named column it does not", () => {
  const text = "gene_id,gene_symbol,x\nENSG1,CD3D,1\nENSG2,CD4,2\nENSG3,CD8A,3";
  assert.equal(parseGeneInput(text).table.column, 0, "no dataset: ids before symbols");
  const r = parseGeneInput(text, { score: (v) => M.countKnown(v, GENES) });
  assert.equal(r.table.column, 1);
  // an unnamed column with more matches does not displace a named one that has some
  const t = parseGeneInput("symbol,other\nCD3D,CD4\nNOPE,CD8A\nNOPE2,IL7R", { score: (v) => M.countKnown(v, GENES) });
  assert.equal(t.table.column, 0);
});

test("id columns: which var column translates Ensembl or Entrez ids", () => {
  assert.equal(M.pickIdColumnFor("ensembl", ["mean", "gene_ids", "feature_name"]), "gene_ids");
  assert.equal(M.pickIdColumnFor("ensembl", ["mean", "Ensembl_ID"]), "Ensembl_ID");
  assert.equal(M.pickIdColumnFor("ensembl", ["gene_ids", "gene_id"]), "gene_id", "ids in ID_COLUMN_PREFERENCE order");
  assert.equal(M.pickIdColumnFor("ensembl", ["mean", "gene_symbol", "feature_name"]), null, "names are not ids");
  assert.equal(M.pickIdColumnFor("ensembl", ["_index", "mean"]), null);
  assert.equal(M.pickIdColumnFor("entrez", ["mean", "Entrez_ID", "gene_ids"]), "Entrez_ID");
  assert.equal(M.pickIdColumnFor("entrez", ["gene_ids"]), null);
  assert.equal(M.pickIdColumnFor("ensembl", undefined), null);
});

test("id kind of the names that did not match", () => {
  const ens = Array.from({ length: 6 }, (_, i) => `ENSG0000000${1000 + i}`);
  assert.equal(M.idKindOf(ens, 6), "ensembl");
  assert.equal(M.idKindOf(ens, 20), null, "a minority of the names");
  assert.equal(M.idKindOf(["1234", "5678", "9"], 3), "entrez");
  assert.equal(M.idKindOf(["FOO1", "BAR2"], 2), null);
  assert.equal(M.idKindOf([], 0), null);
});

test("id map: ids and bare ids to dataset names, and matching through it", () => {
  const genes = ["CD3D", "CD4", "GATA1"];
  const map = M.buildIdMap(["ENSG00000167286.7", "ENSG00000010610", null], genes);
  assert.equal(map.get("ENSG00000167286.7"), "CD3D");
  assert.equal(map.get("ENSG00000167286"), "CD3D", "version stripped");
  assert.equal(map.get("ENSG00000010610"), "CD4");
  assert.equal(map.size, 3);
  const r = matchGenes(["ENSG00000167286.3", "ENSG00000010610", "ENSG00000999999", "GATA1"], { geneNames: genes, idToName: map });
  assert.deepEqual(r.toAdd, ["CD3D", "CD4", "GATA1"], "the recipe gets names, not ids");
  assert.equal(r.idMatches.length, 2);
  assert.deepEqual(r.unmatched, ["ENSG00000999999"]);
});
