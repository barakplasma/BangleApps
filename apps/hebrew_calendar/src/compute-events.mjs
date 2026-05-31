// compute-events.mjs — pure, testable version of the Hebrew calendar event-computation
// logic.  The app.logic.js footer uses the same algorithm but wired to Espruino globals;
// this module is wired to npm packages so it can be imported in Node.js tests.
import { HebrewCalendar, flags as F } from '@hebcal/core';
import SunCalc from 'suncalc';

const DAY_MS = 86400000;

function sunsetOn(date, lat, lon) {
  return SunCalc.getTimes(date, lat, lon).sunset;
}

/**
 * Compute Hebrew calendar events for the ~9-day window around `now`.
 *
 * Returns the same events that app.logic.js's computeEvents() would produce on
 * the watch for the same location, Israel flag, and reference moment.
 *
 * @param {{ lat: number, lon: number }} loc
 * @param {boolean} inIsrael
 * @param {Date|number} [now]  reference moment; defaults to Date.now()
 * @returns {{ desc: string, startEvent: number, endEvent: number }[]}
 */
export function computeEvents(loc, inIsrael, now) {
  const nowMs = now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : Date.now());
  const il = !!inIsrael;
  const { lat, lon } = loc;

  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);

  const rangeStart = new Date(today.getTime() - DAY_MS);
  const rangeEnd   = new Date(today.getTime() + 8 * DAY_MS);

  const rawEvents = HebrewCalendar.calendar({
    il,
    start: rangeStart,
    end: rangeEnd,
    addHebrewDates: true,
    noModern: true,
  });

  const events = [];

  for (const ev of rawEvents) {
    const gregDate   = ev.date.greg();
    const noonDate   = new Date(gregDate.getFullYear(), gregDate.getMonth(), gregDate.getDate(), 12);
    const prevNoon   = new Date(noonDate.getTime() - DAY_MS);
    const sunset     = sunsetOn(noonDate, lat, lon).getTime();
    const prevSunset = sunsetOn(prevNoon, lat, lon).getTime();
    const havdalah   = sunset + 42 * 60000;
    const dayStart   = new Date(gregDate.getFullYear(), gregDate.getMonth(), gregDate.getDate()).getTime();
    const mask       = ev.mask;

    if (mask & F.HEBREW_DATE) {
      events.push({ desc: ev.getDesc(), startEvent: dayStart, endEvent: dayStart + DAY_MS });
      continue;
    }
    if (mask & F.LIGHT_CANDLES) {
      const cl = sunset - 18 * 60000;
      events.push({ desc: 'Candle lighting', startEvent: cl, endEvent: cl + 900000 });
      continue;
    }
    if (mask & F.LIGHT_CANDLES_TZEIS) {
      events.push({ desc: ev.getDesc(), startEvent: prevSunset, endEvent: sunset });
      const tzeis = sunset + 42 * 60000;
      events.push({ desc: 'Candle lighting', startEvent: tzeis, endEvent: tzeis + 900000 });
      continue;
    }
    if (mask & F.YOM_TOV_ENDS) {
      events.push({ desc: ev.getDesc(), startEvent: prevSunset, endEvent: havdalah });
      continue;
    }
    if (mask & F.CHAG) {
      events.push({ desc: ev.getDesc(), startEvent: prevSunset, endEvent: sunset });
      continue;
    }
    if (mask & F.ROSH_CHODESH) {
      events.push({ desc: ev.getDesc(), startEvent: dayStart, endEvent: dayStart + DAY_MS });
      continue;
    }
    if (mask & (F.MINOR_FAST | F.MAJOR_FAST | F.MINOR_HOLIDAY | F.SPECIAL_SHABBAT | F.CHANUKAH_CANDLES)) {
      events.push({ desc: ev.getDesc(), startEvent: dayStart, endEvent: dayStart + DAY_MS });
    }
  }

  // Shabbat events (HebrewCalendar.calendar without candlelighting:true omits them)
  for (let i = -1; i <= 8; i++) {
    const d   = new Date(today.getTime() + i * DAY_MS);
    const dow = d.getDay();
    if (dow === 5) {
      const fSunset = sunsetOn(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12), lat, lon).getTime();
      const fCL     = fSunset - 18 * 60000;
      events.push({ desc: 'Candle lighting', startEvent: fCL, endEvent: fCL + 900000 });
    }
    if (dow === 6) {
      const satNoon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
      const friNoon = new Date(satNoon.getTime() - DAY_MS);
      events.push({
        desc: 'Shabbat',
        startEvent: sunsetOn(friNoon, lat, lon).getTime(),
        endEvent:   sunsetOn(satNoon, lat, lon).getTime() + 42 * 60000,
      });
    }
  }

  return events
    .filter(e => e.endEvent > nowMs - DAY_MS)
    .sort((a, b) => a.startEvent - b.startEvent);
}
