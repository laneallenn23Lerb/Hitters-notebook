/* Voice transcript parser — DOM-free, rule-based.
   Turns a spoken monologue into per-form field values.
   Usable in the browser (window.VoiceParse) and in node (module.exports). */
(function () {
  'use strict';

  var NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

  function numToken(tok) {
    if (/^\d{1,2}$/.test(tok)) {
      var n = parseInt(tok, 10);
      return (n >= 1 && n <= 10) ? n : null;
    }
    return NUM_WORDS[tok] || null;
  }

  // Cue phrases that explicitly name a field. Checked in order; first match wins.
  var CUES = [
    ['pitcherNotes', ['the pitcher was', 'pitcher was', 'about the pitcher', 'he was throwing', 'she was throwing', 'pitcher had', 'his stuff was']],
    ['plan', ['my approach was', 'my approach', 'the plan was', 'my plan was', 'i was hunting', 'i was looking for', 'hunting the', 'looking for the']],
    ['selfTalk', ['my self talk was', 'self talk was', 'i told myself', 'i kept telling myself', 'i said to myself', 'in my head', 'kept saying to myself']],
    ['mechanics', ['mechanically', 'my mechanics', 'my body felt', 'body felt', 'my swing felt', 'swing felt like']],
    ['notes', ['what i want to remember', 'want to remember', 'the lesson is', 'the lesson was', 'my takeaway', 'takeaway is', 'takeaways are', 'next time i will', 'next time i want', 'next time i']],
    ['result', ['the result was', 'i ended up', 'ended up']],
    ['contactQuality', ['contact was', 'the contact felt']],
    ['mentalState', ['mentally i was', 'my mental state']],
    ['cue', ['my cue was', 'cue was']],
    ['focus', ['i was working on', 'working on', 'worked on']]
  ];

  // Fallback keyword scoring for sentences with no explicit cue.
  var KEYWORDS = {
    pitcherNotes: ['pitcher', 'fastball', 'heater', 'slider', 'curve', 'curveball', 'changeup', 'change up', 'cutter', 'sinker', 'two seam', 'four seam', 'splitter', 'velocity', 'velo', 'release', 'arm slot', 'pitch mix', 'mixing', 'tempo', 'deception', 'breaking ball', 'offspeed', 'up in the zone', 'down in the zone', 'painting', 'spotting', 'throwing'],
    plan: ['approach', 'plan', 'hunt', 'hunting', 'looking for', 'stay through', 'staying through', 'through the middle', 'oppo', 'pull side', 'pitch to hit', 'get a pitch', 'zone'],
    result: ['home run', 'homer', 'dinger', 'single', 'double', 'triple', 'struck out', 'strikeout', 'strike out', 'walk', 'walked', 'groundout', 'ground out', 'flyout', 'fly out', 'lineout', 'line out', 'lined out', 'popped up', 'pop up', 'fouled', 'hit by pitch', 'reached base', 'got a hit', 'base hit', 'sac fly', 'flied out', 'grounded out'],
    contactQuality: ['barreled', 'barrel', 'jammed', 'off the end', 'weak contact', 'hard contact', 'smoked', 'flared', 'topped it', 'underneath it', 'squared up', 'sweet spot', 'mishit', 'good contact', 'bad contact'],
    mechanics: ['mechanic', 'timing', 'posture', 'barrel path', 'hands', 'stride', 'load', 'hips', 'shoulder', 'front side', 'balance', 'on time', 'late on', 'early on', 'body'],
    mentalState: ['calm', 'locked in', 'focused', 'confident', 'nervous', 'anxious', 'rushed', 'tight', 'free and easy', 'clear mind', 'distracted', 'frustrated', 'doubtful', 'doubt'],
    selfTalk: ['self talk', 'self-talk', 'told myself', 'say to myself', 'breathe', 'cue word', 'believe'],
    cue: ['my cue'],
    focus: ['tee work', 'tee', 'front toss', 'toss', 'cage', 'drill', 'rounds', 'machine', 'live ab', 'live arm', 'side toss', 'short box', 'wiffle', 'working on'],
    notes: ['remember', 'lesson', 'takeaway', 'next time', 'learned', 'note to self'],
    reflection: []
  };

  var FORM_FIELDS = {
    atbat: ['pitcherNotes', 'plan', 'result', 'contactQuality', 'mechanics', 'mentalState', 'selfTalk', 'cue', 'notes'],
    reflection: ['reflection'],
    individual: ['focus', 'mechanics', 'selfTalk', 'notes']
  };
  var DEFAULT_FIELD = { atbat: 'notes', reflection: 'reflection', individual: 'notes' };

  function splitSentences(text) {
    return text.split(/(?<=[.!?])\s+|\s*;\s*/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function scoreSentence(sent, field) {
    var low = ' ' + sent.toLowerCase() + ' ';
    var s = 0;
    (KEYWORDS[field] || []).forEach(function (kw) {
      if (low.indexOf(kw) !== -1) s += kw.indexOf(' ') !== -1 ? 2 : 1;
    });
    return s;
  }

  // Cue phrases relevant to this form, for a per-sentence explicit-mention bonus.
  function cueBonuses(formKind) {
    var fields = FORM_FIELDS[formKind];
    var out = [];
    CUES.forEach(function (pair) {
      if (fields.indexOf(pair[0]) === -1) return;
      pair[1].forEach(function (cue) { out.push({ field: pair[0], cue: cue }); });
    });
    return out;
  }

  function isRatingSentence(low) {
    return /\b(execut\w*|ratings?|scale)\b/.test(low) ||
      /out of (10|ten)/.test(low) ||
      /\bgive (it|myself)\b/.test(low) ||
      /\bi'd\b/.test(low);
  }

  // Each sentence is scored independently: keyword hits plus a bonus when it
  // explicitly names a field ("the pitcher was…", "my self talk was…").
  // Contrast clauses ("I barreled it but lined out") are split so each half
  // can land in its own field. Pure rating declarations ("I'd rate it a 7")
  // are consumed by the rating extractor and dropped from the text.
  function segment(text, formKind) {
    var fields = FORM_FIELDS[formKind];
    var bonuses = cueBonuses(formKind);
    var buckets = {};
    fields.forEach(function (f) { buckets[f] = []; });
    var push = function (f, s) { s = s.trim(); if (s) buckets[f].push(s); };

    var sentences = [];
    splitSentences(text).forEach(function (sent) {
      sent.split(/\s+but\s+/i).forEach(function (part) {
        part = part.trim();
        if (part) sentences.push(part);
      });
    });

    sentences.forEach(function (sent) {
      var low = sent.toLowerCase();
      var hasCue = bonuses.some(function (cb) { return low.indexOf(cb.cue) !== -1; });
      var best = null, bestScore = 0;
      fields.forEach(function (f) {
        var s = scoreSentence(sent, f);
        bonuses.forEach(function (cb) {
          if (cb.field === f && low.indexOf(cb.cue) !== -1) s += 4;
        });
        if (s > bestScore) { bestScore = s; best = f; }
      });
      if (bestScore === 0 && !hasCue && isRatingSentence(low)) return; // rating captured separately
      push(best || DEFAULT_FIELD[formKind], sent);
    });

    var out = {};
    fields.forEach(function (f) {
      out[f] = buckets[f].join(' ').replace(/\s+/g, ' ').trim();
    });
    return out;
  }

  function extractRating(text, cueWords) {
    var low = text.toLowerCase();
    for (var c = 0; c < cueWords.length; c++) {
      var cue = cueWords[c];
      var idx = low.indexOf(cue);
      while (idx !== -1) {
        var win = low.slice(idx, idx + 80);
        var m = win.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\b/);
        if (m) {
          var n = numToken(m[1]);
          if (n) return n;
        }
        idx = low.indexOf(cue, idx + 1);
      }
    }
    return null;
  }

  function extractOutOfTen(text) {
    var m = text.toLowerCase().match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s+out of\s+(?:10|ten)\b/);
    return m ? numToken(m[1]) : null;
  }

  // Main entry: transcript string + form kind -> { fieldKey: text, execution, ratings }
  function parseTranscript(text, formKind) {
    var t = String(text || '');
    if (!FORM_FIELDS[formKind]) formKind = 'atbat';
    var result = segment(t, formKind);

    if (formKind === 'atbat' || formKind === 'individual') {
      result.execution =
        extractOutOfTen(t) ||
        extractRating(t, ['execut', 'rate the', 'rating', "i'd rate", 'i would rate', 'give it a', 'give myself', 'a solid', 'scale of']) ||
        null;
    }
    if (formKind === 'reflection') {
      result.ratings = {
        competed: extractRating(t, ['competed', 'compete']) || null,
        present: extractRating(t, ['stay present', 'stayed present', 'being present', 'present']) || null,
        adversity: extractRating(t, ['adversity', 'responded to', 'handled the hard', 'hard moments']) || null
      };
    }
    return result;
  }

  var api = { parseTranscript: parseTranscript };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (typeof window !== 'undefined') {
    window.VoiceParse = api;
  }
})();
