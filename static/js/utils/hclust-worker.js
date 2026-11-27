// The clustering worker: one message in ({id, values, rows, cols, linkage, distance, maxRows}), one message out
// ({id, result} or {id, error}). The arrays of the result are transferred, not copied. See hclust.js.
import { clusterRows } from "./hclust.js";

self.onmessage = ({ data }) => {
  const { id, values, rows, cols, linkage, distance, maxRows } = data;
  try {
    const result = clusterRows(values, rows, cols, { linkage, distance, maxRows });
    self.postMessage({ id, result }, [result.order.buffer, result.clustered.buffer, result.excluded.buffer, result.merges.buffer]);
  } catch (e) {
    self.postMessage({ id, error: String(e && e.message ? e.message : e) });
  }
};
