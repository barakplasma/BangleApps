// Plain-object Map replacement for Espruino.
// Replaces the ES6 Map built-in, which requires native subclassing support
// (via Reflect.construct) to extend and may have implementation quirks on
// older Espruino firmware. Keys are coerced to strings (all actual usages
// in @hebcal/core and @hebcal/hdate use string or number keys).
function EspruinoMap() {
  this._d = Object.create(null);
  this.size = 0;
}
EspruinoMap.prototype.get = function(key) {
  return this._d[key];
};
EspruinoMap.prototype.set = function(key, value) {
  if (!(key in this._d)) this.size++;
  this._d[key] = value;
  return this;
};
EspruinoMap.prototype.has = function(key) {
  return key in this._d;
};
EspruinoMap.prototype.delete = function(key) {
  if (!(key in this._d)) return false;
  delete this._d[key];
  this.size--;
  return true;
};
EspruinoMap.prototype.clear = function() {
  this._d = Object.create(null);
  this.size = 0;
};
// Returns a plain Array so Array.from(map.keys()) works without an iterator.
EspruinoMap.prototype.keys = function() {
  return Object.keys(this._d);
};
EspruinoMap.prototype.forEach = function(cb, thisArg) {
  var d = this._d;
  for (var k in d) cb.call(thisArg, d[k], k, this);
};

export default EspruinoMap;
