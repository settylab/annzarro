import { Config } from './config.js';

const CacheManager = (function() {
  const _cache = new Map();
  const _listeners = new Set();

  let _currentSize = 0;
  const _maxEntries = Config.CACHE.MAX_ENTRIES || 200;
  const _totalSizeLimit = Config.CACHE.MAX_SIZE_BYTES || 500 * 1024 * 1024; // 500MB default

  /**
   * Approximate bytes held by a cached value, without serialising it.
   *
   * This used to be `new Blob([JSON.stringify(value)]).size`: a second full
   * JSON encoding of every response on the main thread (hundreds of ms for a
   * 1M-cell column), and for a typed array a stringified object with one key
   * per element. Typed arrays report their byteLength; long plain arrays are
   * sampled.
   */
  function estimateSize(value, depth = 0) {
    if (value === null || value === undefined) return 0;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    if (value instanceof ArrayBuffer) return value.byteLength;
    switch (typeof value) {
      case 'number': case 'boolean': return 8;
      case 'string': return 2 * value.length;
      case 'object': break;
      default: return 0;
    }
    if (depth > 8) return 0;
    if (Array.isArray(value)) {
      const n = value.length;
      if (n === 0) return 0;
      const SAMPLE = 64;
      if (n <= SAMPLE) {
        let total = 0;
        for (let i = 0; i < n; i++) total += estimateSize(value[i], depth + 1);
        return total;
      }
      let sampled = 0;
      const step = n / SAMPLE;
      for (let i = 0; i < SAMPLE; i++) sampled += estimateSize(value[Math.floor(i * step)], depth + 1);
      return Math.round(sampled * (n / SAMPLE));
    }
    let total = 0;
    for (const key of Object.keys(value)) total += 2 * key.length + estimateSize(value[key], depth + 1);
    return total;
  }

  function get(key) {
    const entry = _cache.get(key);
    if (entry && (!entry.expires || entry.expires > Date.now())) {
      return entry.value;
    }
    _remove(key);
    return undefined;
  }

  function set(key, value, ttl = 60000) {
    const expires = ttl > 0 ? Date.now() + ttl : null;
    const size = estimateSize(value);

    // Replacing an entry must not count its old size twice.
    _remove(key);

    // Evict if needed (an empty cache has nothing left to evict)
    while (_cache.size > 0 && (_cache.size >= _maxEntries || (_currentSize + size) > _totalSizeLimit)) {
      const oldestKey = _cache.keys().next().value;
      _remove(oldestKey);
    }

    _cache.set(key, { value, expires, size });
    _currentSize += size;
    _notifyChange(key);
  }

  function _remove(key) {
    const entry = _cache.get(key);
    if (entry) {
      _currentSize -= entry.size || 0;
      _cache.delete(key);
      _notifyChange(key);
    }
  }

  /** Drop one key (no-op when absent). */
  function remove(key) {
    _remove(key);
  }

  function clear(pattern = null) {
    for (const key of _cache.keys()) {
      if (!pattern || key.includes(pattern)) {
        _remove(key);
      }
    }
  }

  function has(key) {
    return get(key) !== undefined;
  }

  /**
   * Live (unexpired) keys, oldest first. Expired entries are dropped on the
   * way, exactly as `get` would drop them.
   * @returns {string[]}
   */
  function keys() {
    const now = Date.now();
    const live = [];
    for (const [key, entry] of [..._cache]) {
      if (entry.expires && entry.expires <= now) {
        _remove(key);
      } else {
        live.push(key);
      }
    }
    return live;
  }

  function _notifyChange(key) {
    for (const cb of _listeners) {
      try {
        cb(key);
      } catch (e) {
        console.warn("CacheManager listener error:", e);
      }
    }
  }

  function onChange(callback) {
    _listeners.add(callback);
    return () => _listeners.delete(callback); // unsubscribe fn
  }

  /** Approximate bytes held (estimateSize of every entry), for the browser memory guard. */
  function bytes() {
    return _currentSize;
  }

  return {
    get,
    set,
    clear,
    remove,
    has,
    keys,
    onChange,
    bytes
  };
})();

export { CacheManager };
