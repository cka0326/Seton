// SM-2-style spaced repetition scheduling.
// srs = { ease, interval (days), reps, due (ms epoch) }

const DAY = 24 * 60 * 60 * 1000;

export function newSrs() {
  return { ease: 2.5, interval: 0, reps: 0, due: Date.now() };
}

export function isDue(srs, now = Date.now()) {
  return !srs || (srs.due || 0) <= now;
}

// grade: 'again' | 'hard' | 'good' | 'easy'
export function schedule(srs, grade, now = Date.now()) {
  const s = { ...(srs || newSrs()) };
  switch (grade) {
    case 'again':
      s.reps = 0;
      s.interval = 0;
      s.ease = Math.max(1.3, s.ease - 0.2);
      s.due = now + 10 * 60 * 1000; // 10 minutes
      return s;
    case 'hard':
      s.reps += 1;
      s.ease = Math.max(1.3, s.ease - 0.15);
      s.interval = s.interval < 1 ? 0.5 : s.interval * 1.2;
      break;
    case 'good':
      s.reps += 1;
      s.interval = s.reps <= 1 ? 1 : s.interval * s.ease;
      break;
    case 'easy':
      s.reps += 1;
      s.ease += 0.15;
      s.interval = s.reps <= 1 ? 3 : s.interval * s.ease * 1.3;
      break;
    default:
      return s;
  }
  s.interval = Math.min(s.interval, 365);
  s.due = now + s.interval * DAY;
  return s;
}

export function intervalPreview(srs, grade) {
  const s = schedule(srs, grade);
  const ms = s.due - Date.now();
  if (ms < 60 * 60 * 1000) return `${Math.round(ms / 60000)}m`;
  if (ms < DAY * 1.5) return '1d';
  return `${Math.round(ms / DAY)}d`;
}
