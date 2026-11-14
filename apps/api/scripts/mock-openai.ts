/**
 * Minimal OpenAI-compatible server used to verify WattBot without a paid key.
 *
 *   pnpm --filter @wattnexa/api exec tsx scripts/mock-openai.ts
 *
 * Then point the API at it:
 *   WATTBOT_PROVIDER=openai OPENAI_API_KEY=sk-local-mock \
 *   OPENAI_BASE_URL=http://localhost:4801/v1 pnpm --filter @wattnexa/api dev
 *
 * Behaviour is driven by markers in the user's question:
 *   MOCK_RATE_LIMIT → HTTP 429
 *   MOCK_SLOW       → 6s delay (to exercise WATTBOT_TIMEOUT_MS)
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_OPENAI_PORT ?? 4801);

const chunk = (text: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

createServer((req, res) => {
  if (!req.url?.startsWith('/v1/chat/completions') || req.method !== 'POST') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
    return;
  }

  let body = '';
  req.on('data', (chunkPart) => {
    body += chunkPart;
  });

  req.on('end', () => {
    void (async () => {
      let parsed: { stream?: boolean; messages?: Array<{ content?: string }> } = {};
      try {
        parsed = JSON.parse(body) as typeof parsed;
      } catch {
        res.writeHead(400).end();
        return;
      }

      const prompt = (parsed.messages ?? []).map((message) => message.content ?? '').join('\n');

      if (prompt.includes('MOCK_RATE_LIMIT')) {
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Rate limit reached', type: 'rate_limit_exceeded' } }));
        return;
      }

      if (prompt.includes('MOCK_SLOW')) {
        await new Promise((resolve) => setTimeout(resolve, 6_000));
      }

      const answer =
        'From your stored readings: month to date is 120.9 kWh, estimated at 765.31 on the BESCOM tariff. ' +
        'This mock reply exists only to prove the provider path, not to state real figures.';

      if (parsed.stream) {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        for (const part of ['From your stored readings: ', 'month to date is 120.9 kWh, ', 'estimated at 765.31.']) {
          res.write(chunk(part));
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
    })();
  });
}).listen(PORT, () => console.log(`mock OpenAI-compatible server listening on http://localhost:${PORT}/v1`));
