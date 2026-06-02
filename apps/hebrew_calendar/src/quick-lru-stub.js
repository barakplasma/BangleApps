// Stub for quick-lru — replaces `class QuickLRU extends Map` with a plain
// object cache. quick-lru uses private class fields, Map inheritance, and
// generator methods; none of these translate safely to Espruino.
// On a watch we cache at most a handful of timezone formatters / holiday
// years, so a no-eviction object cache is sufficient.
function QuickLRU(opts) {
  if (!(opts && opts.maxSize > 0)) {
    throw new TypeError('`maxSize` must be a number greater than 0');
  }
  this._cache = Object.create(null);
}
QuickLRU.prototype.get = function(key) {
  return this._cache[key];
};
QuickLRU.prototype.set = function(key, value) {
  this._cache[key] = value;
  return this;
};
QuickLRU.prototype.has = function(key) {
  return key in this._cache;
};
QuickLRU.prototype.delete = function(key) {
  if (key in this._cache) {
    delete this._cache[key];
    return true;
  }
  return false;
};
QuickLRU.prototype.clear = function() {
  this._cache = Object.create(null);
};

export default QuickLRU;
