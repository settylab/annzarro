import { Config } from './config.js';

const CacheManager = (function() {
  const _cache = new Map();
  const _listeners = new Set();

  let _currentSize = 0;
  const _maxEntries = Config.CACHE.MAX_ENTRIES || 200;
  const _totalSizeLimit = Config.CACHE.MAX_SIZE_BYTES || 500 * 1024 * 1024; // 500MB default

  function estimateSize(value) {
    try {
      return new Blob([JSON.stringify(value)]).size;
    } catch (e) {
      console.warn("Failed to estimate cache entry size", e);
      return 0;
    }
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

    // Evict if needed
    while (_cache.size >= _maxEntries || (_currentSize + size) > _totalSizeLimit) {
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

  return {
    get,
    set,
    clear,
    has,
    onChange
  };
})();

export { CacheManager };
