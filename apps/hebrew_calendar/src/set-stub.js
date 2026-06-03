// Plain-array Set replacement for Espruino.
// Espruino supports Set since firmware 2v00, but it is absent from older
// builds and some edge-case contexts. Replacing it unconditionally (via
// @rollup/plugin-inject, just like Map) removes the runtime dependency and
// makes the bundle firmware-version-independent.
// Keys may be strings or objects; identity is by indexOf (===).
function EspruinoSet() {
  this._d = [];
}
EspruinoSet.prototype.add = function(v) {
  if (this._d.indexOf(v) < 0) this._d.push(v);
  return this;
};
EspruinoSet.prototype.has = function(v) {
  return this._d.indexOf(v) >= 0;
};
EspruinoSet.prototype.delete = function(v) {
  var i = this._d.indexOf(v);
  if (i < 0) return false;
  this._d.splice(i, 1);
  return true;
};
EspruinoSet.prototype.clear = function() {
  this._d = [];
};
EspruinoSet.prototype.forEach = function(cb, thisArg) {
  for (var i = 0; i < this._d.length; i++) cb.call(thisArg, this._d[i], this._d[i], this);
};

export default EspruinoSet;
