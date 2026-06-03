// Minimal sedra stub for @hebcal/core.
//
// calendar.js only calls getSedra() when options.sedrot is set — we never set it.
// holidays.js calls getSedra(year, false).find(15) unconditionally to compute
// Shabbat Shirah (the Shabbat when Parashat Beshalach is read).
//
// Beshalach (parsha index 15, 0-based) is always at offset 18 or 19 weeks from
// the first Saturday of the Hebrew year. Empirically verified over years 5700–5900:
//   - Rosh Hashana on Saturday → offset = 19
//   - Rosh Hashana on any other day → offset = 18
// The first Saturday on or after RH is: RH + ((6 - RH_dayOfWeek) % 7).
//
// Everything else (Sedra class, parshiot array, sedra.lookup) is only used when
// options.sedrot=true, which our app never sets; those are left as no-ops.

import { HDate } from '@hebcal/hdate';

export function getSedra(year) {
  var rh = HDate.hebrew2abs(year, 7, 1);
  var rhDow = rh % 7; // 0=Sun ... 6=Sat
  var firstSaturday = rh + ((6 - rhDow) % 7);
  var idx = (rhDow === 6) ? 19 : 18;
  return {
    find: function(p) {
      return (p === 15) ? new HDate(firstSaturday + idx * 7) : null;
    },
  };
}

export function Sedra() {}
export var parshiot = [];
