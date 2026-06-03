// Stub for @hebcal/core location.js.
// We never pass options.location or options.candlelighting, so the full Location
// class (12 KB) is never used. defaultLocation = new Location(0,0,false,'UTC')
// is constructed at module init; getIsrael() is called once but our explicit
// options.il overrides it.
export function Location(lat, lon, il) {
  this.il = !!il;
}
Location.prototype.getIsrael = function() { return this.il; };
Location.prototype.getLatitude = function() { return this.lat; };
Location.prototype.getLongitude = function() { return this.lon; };
Location.prototype.getLocationName = function() { return ''; };
Location.prototype.getTzid = function() { return 'UTC'; };
