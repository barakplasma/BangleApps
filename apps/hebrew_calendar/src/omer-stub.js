// Stub for @hebcal/core omer.js — OmerEvent is only instantiated when options.omer=true,
// which we never set.
export function OmerEvent(d, n) { this.date = d; this.omerDay = n; }
OmerEvent.prototype.getDesc = function() { return 'Omer ' + this.omerDay; };
OmerEvent.prototype.mask = 0;
