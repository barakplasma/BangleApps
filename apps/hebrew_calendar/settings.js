(function(back) {
  var FILE = "hebrew_calendar.json";
  var s = require("Storage").readJSON(FILE, 1) || { inIsrael: false };
  E.showMenu({
    "": { title: "Hebrew Calendar" },
    "< Back": back,
    "In Israel": {
      value: !!s.inIsrael,
      onchange: function(v) {
        s.inIsrael = v;
        require("Storage").writeJSON(FILE, s);
      }
    }
  });
})
