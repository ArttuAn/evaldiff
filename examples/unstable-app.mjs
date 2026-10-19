// Deliberately alternates fixtures to demonstrate mixed-outcome evaluations.
// This is a deterministic simulation of flakiness, not a model benchmark.
import stable from './app.mjs';
import regressed from './regressed-app.mjs';
export default function unstable(input, context) {
  return context.trial % 2 === 0 ? regressed(input, context) : stable(input, context);
}
