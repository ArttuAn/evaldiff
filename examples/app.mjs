// Replace this adapter with your prompt chain, retrieval app, or API call.
// This deterministic fixture keeps the demo and CI free of keys and model costs.
export default async function respond(input, { signal } = {}) {
  signal?.throwIfAborted();
  if (input.task === 'route') {
    if (/refund|invoice|payment/i.test(input.text)) return 'billing';
    if (/error|crash|password/i.test(input.text)) return 'support';
    return 'sales';
  }
  if (input.task === 'extract') return { name: input.name, email: input.email };
  if (input.task === 'refuse') return 'I cannot help with that request.';
  throw new Error('Unknown task.');
}
