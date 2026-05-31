import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import SunCalc from 'suncalc';
import { computeEvents } from './compute-events.mjs';

const DAY_MS = 86400000;

// ── Well-known locations ──────────────────────────────────────────────────────

const JERUSALEM    = { lat: 31.78,  lon: 35.23  };
const NEW_YORK     = { lat: 40.71,  lon: -74.01 };
const LONDON       = { lat: 51.51,  lon: -0.13  };
const BUENOS_AIRES = { lat: -34.60, lon: -58.40 };

// ── fast-check arbitraries ────────────────────────────────────────────────────

// Avoid polar latitudes where suncalc may return NaN for sunset.
const latArb = fc.double({ min: -60, max: 60,   noNaN: true, noDefaultInfinity: true });
const lonArb = fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true });
const locArb = fc.record({ lat: latArb, lon: lonArb });
const nowArb = fc.date({ min: new Date('2024-01-01'), max: new Date('2028-12-31') });
const ilArb  = fc.boolean();

// A combined arbitrary for the three parameters together.
const argsArb = fc.tuple(locArb, ilArb, nowArb);

// Skip a property-test run if SunCalc returns an invalid sunset (polar edge case
// within the ±60° lat range can still occur near solstices at extreme longitudes).
function sunsetValid(date, loc) {
  const s = SunCalc.getTimes(date, loc.lat, loc.lon).sunset;
  return s && !isNaN(s.getTime());
}

// ── Structural invariants (property tests) ────────────────────────────────────

describe('structural invariants', () => {
  it('all events have positive duration (startEvent < endEvent)', () => {
    fc.assert(
      fc.property(argsArb, ([loc, il, now]) => {
        const events = computeEvents(loc, il, now);
        return events.every(e => e.startEvent < e.endEvent);
      }),
      { numRuns: 150 },
    );
  });

  it('events are sorted ascending by startEvent', () => {
    fc.assert(
      fc.property(argsArb, ([loc, il, now]) => {
        const events = computeEvents(loc, il, now);
        for (let i = 1; i < events.length; i++) {
          if (events[i].startEvent < events[i - 1].startEvent) return false;
        }
        return true;
      }),
      { numRuns: 150 },
    );
  });

  it('all descriptions are non-empty strings', () => {
    fc.assert(
      fc.property(argsArb, ([loc, il, now]) => {
        const events = computeEvents(loc, il, now);
        return events.every(e => typeof e.desc === 'string' && e.desc.length > 0);
      }),
      { numRuns: 150 },
    );
  });

  it('always returns at least one event', () => {
    fc.assert(
      fc.property(argsArb, ([loc, il, now]) => {
        return computeEvents(loc, il, now).length > 0;
      }),
      { numRuns: 150 },
    );
  });

  it('candle lighting events are always exactly 15 minutes long', () => {
    fc.assert(
      fc.property(argsArb, ([loc, il, now]) => {
        return computeEvents(loc, il, now)
          .filter(e => e.desc === 'Candle lighting')
          .every(e => e.endEvent - e.startEvent === 900000);
      }),
      { numRuns: 150 },
    );
  });

  it('Hebrew date events span exactly one civil day', () => {
    fc.assert(
      fc.property(argsArb, ([loc, il, now]) => {
        return computeEvents(loc, il, now)
          .filter(e => /^\d+ \w/.test(e.desc))   // "14 Nisan 5786" pattern
          .every(e => e.endEvent - e.startEvent === DAY_MS);
      }),
      { numRuns: 150 },
    );
  });
});

// ── Shabbat invariants (property tests) ──────────────────────────────────────

describe('Shabbat invariants', () => {
  it('every Friday in the 9-day window has a Candle lighting event at sunset−18 min', () => {
    fc.assert(
      fc.property(argsArb, ([loc, il, now]) => {
        const events = computeEvents(loc, il, now);
        const today  = new Date(now);
        today.setHours(0, 0, 0, 0);

        // Start from i=0 (today), not i=-1.  The filter `endEvent > nowMs - DAY_MS`
        // can legitimately exclude the i=-1 Friday's candle lighting if `now` is on
        // a Saturday whose exact ms value makes the Friday sunset - 3 min boundary
        // exactly equal nowMs - DAY_MS (strict >).
        for (let i = 0; i <= 8; i++) {
          const d = new Date(today.getTime() + i * DAY_MS);
          if (d.getDay() !== 5) continue;

          const noon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
          if (!sunsetValid(noon, loc)) continue;

          const expectedCL = SunCalc.getTimes(noon, loc.lat, loc.lon).sunset.getTime() - 18 * 60000;
          const found = events.some(e =>
            e.desc === 'Candle lighting' && Math.abs(e.startEvent - expectedCL) < 1000,
          );
          if (!found) return false;
        }
        return true;
      }),
      { numRuns: 150 },
    );
  });

  it('every Saturday in the 9-day window has a Shabbat event spanning Fri sunset → Sat havdalah', () => {
    fc.assert(
      fc.property(argsArb, ([loc, il, now]) => {
        const events = computeEvents(loc, il, now);
        const today  = new Date(now);
        today.setHours(0, 0, 0, 0);

        // Same reasoning as the Friday test: start from i=0 to avoid the
        // i=-1 Saturday whose Shabbat endEvent can sit exactly on the filter
        // boundary when now is the following Sunday at the right exact ms.
        for (let i = 0; i <= 8; i++) {
          const d = new Date(today.getTime() + i * DAY_MS);
          if (d.getDay() !== 6) continue;

          const satNoon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
          const friNoon = new Date(satNoon.getTime() - DAY_MS);
          if (!sunsetValid(satNoon, loc) || !sunsetValid(friNoon, loc)) continue;

          const expectedStart = SunCalc.getTimes(friNoon, loc.lat, loc.lon).sunset.getTime();
          const expectedEnd   = SunCalc.getTimes(satNoon, loc.lat, loc.lon).sunset.getTime() + 42 * 60000;

          const found = events.some(e =>
            e.desc === 'Shabbat' &&
            Math.abs(e.startEvent - expectedStart) < 1000 &&
            Math.abs(e.endEvent   - expectedEnd)   < 1000,
          );
          if (!found) return false;
        }
        return true;
      }),
      { numRuns: 150 },
    );
  });
});

// ── Location sensitivity tests ────────────────────────────────────────────────

describe('location sensitivity', () => {
  // Oct 10 2025 is a Friday during Chol HaMoed Sukkot — no holiday candle
  // lighting, so the only CL event that day is the Shabbat one.  Jerusalem
  // (lon≈35°E) is well east of London (lon≈0°), so its UTC sunset is earlier.
  it('Jerusalem candle lighting is earlier in UTC than London on the same Friday', () => {
    const friday = new Date('2025-10-10T12:00:00');
    const fridayNoon = new Date(2025, 9, 10, 12);  // Oct 10 12:00 local

    const jSunset = SunCalc.getTimes(fridayNoon, JERUSALEM.lat, JERUSALEM.lon).sunset.getTime();
    const lSunset = SunCalc.getTimes(fridayNoon, LONDON.lat,    LONDON.lon).sunset.getTime();
    const jExpectedCL = jSunset - 18 * 60000;
    const lExpectedCL = lSunset - 18 * 60000;

    const jEvents = computeEvents(JERUSALEM, false, friday);
    const lEvents = computeEvents(LONDON,    false, friday);

    const findCL = (events, expectedCL) =>
      events.find(e => e.desc === 'Candle lighting' && Math.abs(e.startEvent - expectedCL) < 1000);

    expect(findCL(jEvents, jExpectedCL)).toBeDefined();
    expect(findCL(lEvents, lExpectedCL)).toBeDefined();

    // Jerusalem is ~35° east of London → earlier UTC sunset → earlier candle lighting.
    expect(jExpectedCL).toBeLessThan(lExpectedCL);
  });

  // Property: for any realistic location, the candle lighting suncalc returns
  // from computeEvents matches what raw SunCalc would give for that longitude.
  it('candle lighting time equals suncalc sunset − 18 min for every location (property)', () => {
    fc.assert(
      fc.property(locArb, nowArb, (loc, now) => {
        // Find the next Friday noon from `now` (within i=0..8).
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);
        let fridayNoon = null;
        for (let i = 0; i <= 8; i++) {
          const d = new Date(today.getTime() + i * DAY_MS);
          if (d.getDay() === 5) {
            fridayNoon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
            break;
          }
        }
        if (!fridayNoon || !sunsetValid(fridayNoon, loc)) return true;

        const expectedCL = SunCalc.getTimes(fridayNoon, loc.lat, loc.lon).sunset.getTime() - 18 * 60000;
        const events = computeEvents(loc, false, now);
        return events.some(e => e.desc === 'Candle lighting' && Math.abs(e.startEvent - expectedCL) < 1000);
      }),
      { numRuns: 150 },
    );
  });
});

// ── Known-date tests ──────────────────────────────────────────────────────────

describe('known dates', () => {
  // 2025-09-22 is Erev Rosh Hashanah 5786 → LIGHT_CANDLES → Candle lighting
  it('Erev Rosh Hashanah 5786 (Sep 22 2025) produces a Candle lighting in Jerusalem', () => {
    const now    = new Date('2025-09-22T12:00:00');
    const events = computeEvents(JERUSALEM, false, now);
    const cl     = events.filter(e => e.desc === 'Candle lighting');
    expect(cl.length).toBeGreaterThan(0);
  });

  // 2025-09-23 is 1 Tishrei 5786 (Rosh Hashanah day 1)
  it('Rosh Hashana 5786 (Sep 23 2025) appears in the window for NY diaspora', () => {
    const now    = new Date('2025-09-23T12:00:00');
    const events = computeEvents(NEW_YORK, false, now);
    const rh     = events.filter(e => e.desc.includes('Rosh Hashana'));
    expect(rh.length).toBeGreaterThan(0);
    rh.forEach(e => expect(e.startEvent).toBeLessThan(e.endEvent));
  });

  // 2025-10-01 is Erev Yom Kippur → LIGHT_CANDLES
  it('Erev Yom Kippur 5786 (Oct 1 2025) produces a Candle lighting in London', () => {
    const now    = new Date('2025-10-01T12:00:00');
    const events = computeEvents(LONDON, false, now);
    const cl     = events.filter(e => e.desc === 'Candle lighting');
    expect(cl.length).toBeGreaterThan(0);
  });

  // 2025-10-02 is Yom Kippur → YOM_TOV_ENDS → spans prevSunset..havdalah
  it('Yom Kippur 5786 (Oct 2 2025) spans from Erev sunset to havdalah', () => {
    const now    = new Date('2025-10-02T12:00:00');
    const events = computeEvents(NEW_YORK, false, now);
    const yk     = events.find(e => e.desc === 'Yom Kippur');
    expect(yk).toBeDefined();

    // Should start at Oct 1 sunset (prevSunset) and end 42 min after Oct 2 sunset.
    const oct1Noon = new Date(2025, 9, 1, 12);  // months are 0-indexed
    const oct2Noon = new Date(2025, 9, 2, 12);
    const prevSunset = SunCalc.getTimes(oct1Noon, NEW_YORK.lat, NEW_YORK.lon).sunset.getTime();
    const sunset     = SunCalc.getTimes(oct2Noon, NEW_YORK.lat, NEW_YORK.lon).sunset.getTime();

    expect(yk.startEvent).toBeCloseTo(prevSunset, -3);  // within 1 second
    expect(yk.endEvent).toBeCloseTo(sunset + 42 * 60000, -3);
  });

  // 2025-12-14 is Chanukah: 1 Candle (CHANUKAH_CANDLES)
  it('Chanukah 5786 first night (Dec 14 2025) appears in New York', () => {
    const now    = new Date('2025-12-14T12:00:00');
    const events = computeEvents(NEW_YORK, false, now);
    const chan   = events.filter(e => e.desc.toLowerCase().includes('chanukah'));
    expect(chan.length).toBeGreaterThan(0);
  });

  // Shavuot 5786: diaspora has 2 days, Israel has 1
  it('Shavuot 5786 diaspora (May 22-23 2026): two holiday events; Israel: one', () => {
    const now          = new Date('2026-05-22T12:00:00');
    const diasporaEvs  = computeEvents(NEW_YORK,  false, now);
    const israelEvs    = computeEvents(JERUSALEM, true,  now);

    const diasporaShav = diasporaEvs.filter(e => e.desc.includes('Shavuot'));
    const israelShav   = israelEvs.filter(e => e.desc.includes('Shavuot'));

    // Diaspora: Shavuot I (LIGHT_CANDLES_TZEIS) + Shavuot II (YOM_TOV_ENDS) = 2 events
    expect(diasporaShav.length).toBe(2);
    // Israel: single-day Shavuot (YOM_TOV_ENDS) = 1 event
    expect(israelShav.length).toBe(1);
  });

  // Erev Pesach 5786 is Apr 1 2026 → LIGHT_CANDLES
  it('Erev Pesach 5786 (Apr 1 2026) produces a Candle lighting in Buenos Aires', () => {
    const now    = new Date('2026-04-01T12:00:00');
    const events = computeEvents(BUENOS_AIRES, false, now);
    const cl     = events.filter(e => e.desc === 'Candle lighting');
    expect(cl.length).toBeGreaterThan(0);
  });

  // A Friday in London summer → later candle lighting than a Friday in winter
  it('London summer Shabbat has later candle lighting time-of-day than winter Shabbat', () => {
    const summerFri = new Date('2025-06-27T12:00:00');  // Friday, June (summer)
    const winterFri = new Date('2025-12-19T12:00:00');  // Friday, December (winter)

    const summerEvs = computeEvents(LONDON, false, summerFri);
    const winterEvs = computeEvents(LONDON, false, winterFri);

    const fridayCL = (events, refDate) => {
      const midnight = new Date(refDate);
      midnight.setHours(0, 0, 0, 0);
      return events.find(
        e => e.desc === 'Candle lighting' &&
             e.startEvent >= midnight.getTime() &&
             e.startEvent <  midnight.getTime() + DAY_MS,
      );
    };

    const summerCL = fridayCL(summerEvs, summerFri);
    const winterCL = fridayCL(winterEvs, winterFri);

    expect(summerCL).toBeDefined();
    expect(winterCL).toBeDefined();

    // Time-of-day in UTC: summer sunset is later.
    const timeOfDay = ts => ts % DAY_MS;
    expect(timeOfDay(summerCL.startEvent)).toBeGreaterThan(timeOfDay(winterCL.startEvent));
  });

  // Default `now` (omitted) should not throw and should return events.
  it('works when now is omitted (defaults to current time)', () => {
    const events = computeEvents(JERUSALEM, false);
    expect(events.length).toBeGreaterThan(0);
  });
});
