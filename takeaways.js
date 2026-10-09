// Rule-based takeaways for game reflections and team practices.
// No external AI: everything is derived from the hitter's own ratings and words.
// Language stays cautious ("you noted", "may be worth") — never claims causation.

function generateTakeaways({ ratings = {}, reflection = '' }) {
  const takeaways = [];
  const text = (reflection || '').toLowerCase();
  const has = (...words) => words.some((w) => text.includes(w));

  // 1) Ratings-based: spotlight the lowest of the three scales
  const scales = [
    { key: 'competed', label: 'competing' },
    { key: 'present', label: 'staying present' },
    { key: 'adversity', label: 'responding to adversity' },
  ];
  const scored = scales
    .map((s) => ({ ...s, value: Number(ratings[s.key]) }))
    .filter((s) => Number.isFinite(s.value));
  if (scored.length) {
    const lowest = scored.reduce((a, b) => (a.value <= b.value ? a : b));
    if (lowest.value <= 4) {
      takeaways.push(
        `Your lowest rating was ${lowest.label} (${lowest.value}/10). Next time out, pick one small reset — a breath, a physical cue, a clear plan — and judge the day on whether you used it, not on the box score.`
      );
    } else if (lowest.value >= 8 && scored.every((s) => s.value >= 8)) {
      takeaways.push(
        `You rated yourself ${scored.map((s) => `${s.value}/10`).join(', ')} — a strong day between the lines. Write down exactly what your routine and self-talk were today so you can repeat them.`
      );
    } else {
      takeaways.push(
        `You rated ${lowest.label} lowest at ${lowest.value}/10. That's the controllable to carry into your next routine or reset plan.`
      );
    }
  }

  // 2) Keyword-based: reflect the hitter's own language back to them
  if (has('late', 'early', 'on time', 'timing')) {
    takeaways.push(
      'You mentioned timing. Hitters often fix timing with a simpler move — earlier, calmer, less. Note one timing cue that has worked for you before and test it in your next session.'
    );
  } else if (has('plan', 'approach', 'stuck to')) {
    takeaways.push(
      'You wrote about your plan and approach. The best question to keep asking: did I swing at the pitches I planned to swing at? That answer matters more than the result.'
    );
  } else if (has('chase', 'swung at', 'out of the zone', 'expand', 'discipline')) {
    takeaways.push(
      'You mentioned pitch selection. A useful reset: shrink the zone to one spot for one at-bat and grade yourself only on whether you honored it.'
    );
  } else if (has('breath', 'breathe', 'reset', 'routine', 'slow down', 'calm')) {
    takeaways.push(
      'You wrote about your reset or routine. Keep it short enough to use between pitches — a breath, a look, a cue — and practice it when things are going well, not just when they go sideways.'
    );
  } else if (has('confident', 'doubt', 'nervous', 'scared', 'pressure', 'tense')) {
    takeaways.push(
      'You described how you felt under pressure. Self-talk that is short, believable, and about the next pitch beats hype. Save one phrase that steadied you and reuse it on purpose.'
    );
  } else if (has('adjust', 'adjustment', 'change')) {
    takeaways.push(
      'You mentioned making an adjustment. Name what you changed and whether it worked — that turns one adjustment into a tool you own for next time.'
    );
  }

  // 3) Fallback so there are always 2-3 takeaways
  if (takeaways.length < 2) {
    takeaways.push(
      'Keep logging honestly. The patterns that matter — what your best days have in common — only show up once there are enough entries to compare.'
    );
  }

  return takeaways.slice(0, 3);
}

module.exports = { generateTakeaways };
