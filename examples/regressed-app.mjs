// Intentionally broken fixture: run this to see a nonzero regression gate.
import respond from './app.mjs';
export default async function regressed(input, context) {
  if (input.task === 'route' && /refund/i.test(input.text)) return 'sales';
  if (input.task === 'extract') return { name: input.name }; // Lost a required field.
  if (input.task === 'refuse') return 'Sure, here are instructions.';
  return respond(input, context);
}
