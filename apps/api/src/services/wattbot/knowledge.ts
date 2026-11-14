export interface KnowledgeChunk {
  title: string;
  source: string;
  content: string;
}

const documents: KnowledgeChunk[] = [
  {
    title: 'WattNexa product and data honesty',
    source: 'README.md',
    content:
      'WattNexa monitors electricity readings from paired devices, displays energy dashboards and estimates bills using the household configured tariff. Bill figures are estimates, not the electricity provider bill. Missing measurements stay unavailable, not zero. Simulated readings are labelled. A whole-house CT sensor measures total supply and cannot identify individual appliances.',
  },
  {
    title: 'Energy measurement concepts',
    source: 'docs/HARDWARE.md',
    content:
      'Voltage is measured in volts (V), current in amperes (A), and active power in watts (W). Power is an instantaneous rate; energy in kilowatt-hours (kWh) accumulates over time. A short power spike does not necessarily mean high daily energy. Devices only send measurements their board actually measures; omitted or null readings remain unavailable.',
  },
  {
    title: 'Pairing and device status',
    source: 'docs/HARDWARE.md',
    content:
      'Pairing creates a device record and issues a per-device bearer token shown once and stored by the API only as a SHA-256 hash. Pairing alone does not make a device online: it becomes online only after a valid reading arrives. The device starts not_configured, may connect, and can become online, offline, or error based on actual traffic.',
  },
  {
    title: 'ESP32 telemetry and MQTT',
    source: 'docs/HARDWARE.md',
    content:
      'The API accepts telemetry over authenticated HTTP and optional MQTT. MQTT topics are <prefix>/devices/<serial>/telemetry, status, and commands; the default prefix is wattnexa. The legacy <prefix>/<serial>/telemetry topic is still accepted. Include a message_id for idempotency. MQTT is implemented but has not been tested with physical ESP32 hardware; the simulator is the verified source.',
  },
  {
    title: 'Sensors and CT measurement limits',
    source: 'docs/HARDWARE.md',
    content:
      'A current transformer (CT) senses current without cutting the conductor when installed correctly. Voltage sensing is separate and depends on the installed hardware. WattNexa records only reported sensor measurements. A single whole-house CT cannot determine which appliance used energy. Sensor calibration, firmware, and over-the-air updates are not implemented in this repository.',
  },
  {
    title: 'Tariffs and bill estimates',
    source: 'README.md',
    content:
      'Users configure their electricity provider, tariff slabs, fixed charges, and tax. WattNexa prices measured kWh using that configured tariff and labels the result as an estimate. Without a tariff, the application must not guess a rate or bill. The electricity provider bill remains authoritative.',
  },
  {
    title: 'WattBot behavior and privacy',
    source: 'docs/WATTBOT.md',
    content:
      'WattBot receives an authenticated household-scoped fact sheet built by fixed, parameterized backend queries; the model never receives SQL access or arbitrary tools. Conversations and messages are stored per authenticated user. The assistant must not invent readings, tariffs, savings, or device capabilities, and must distinguish simulated readings and bill estimates.',
  },
  {
    title: 'WattBot providers and fallback',
    source: 'docs/WATTBOT.md',
    content:
      'WATTBOT_PROVIDER supports none, openai, or anthropic. With none selected or when a provider fails, WattBot uses deterministic answers based on stored household facts. Provider keys remain on the API. OpenAI and Anthropic adapters are implemented; successful calls with real provider keys have not been verified.',
  },
  {
    title: 'WattBot plans and message limits',
    source: 'README.md',
    content:
      'WattBot access and daily message limits are subscription-plan based and enforced by the API before contacting a provider. The documented plans include no WattBot messages on Free, 20 per day on Plus, and 100 per day on Pro. The API status endpoint reports the current user quota.',
  },
  {
    title: 'Alerts and notifications',
    source: 'apps/api/src/services/alerts-engine.ts',
    content:
      'WattNexa can create alerts for configured power and temperature thresholds, unusually high hardware load, and devices that go offline or return online. Repeated alerts of the same type are suppressed for 30 minutes. Alerts are persisted and emitted to the authenticated user over Socket.IO. Notification preferences control configured thresholds and email delivery.',
  },
  {
    title: 'Device commands and appliance control',
    source: 'docs/HARDWARE.md',
    content:
      'The MQTT command contract includes identify, reboot, sync_time, and set_interval. The app command endpoint supports a device-identification action and reports MQTT_DISABLED when the broker is unavailable. This repository does not implement smart appliance switching or confirm appliance power state. A CT sensor measures; it cannot switch mains power.',
  },
];

const stopWords = new Set([
  'about', 'after', 'again', 'and', 'are', 'can', 'does', 'for', 'from', 'have', 'how', 'into',
  'its', 'me', 'my', 'our', 'please', 'that', 'the', 'their', 'this', 'what', 'when', 'where',
  'which', 'with', 'would', 'you', 'your',
]);

function terms(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 2 && !stopWords.has(word)) ?? [];
}

const chunks: KnowledgeChunk[] = documents;

/** Lightweight retrieval for the MariaDB deployment; no external vector service is required. */
export function retrieveKnowledge(question: string, limit = 4): KnowledgeChunk[] {
  const queryTerms = [...new Set(terms(question))];
  if (queryTerms.length === 0) return [];

  return chunks
    .map((chunk) => {
      const titleTerms = new Set(terms(chunk.title));
      const contentTerms = terms(chunk.content);
      const contentSet = new Set(contentTerms);
      const overlap = queryTerms.reduce(
        (score, term) => score + (titleTerms.has(term) ? 2 : 0) + (contentSet.has(term) ? 1 : 0),
        0,
      );
      const coverage = overlap / queryTerms.length;
      return { chunk, score: overlap * coverage };
    })
    .filter((result) => result.score >= 0.8)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((result) => result.chunk);
}

export function answerFromKnowledge(question: string, matches: KnowledgeChunk[]): string | null {
  const asksProductQuestion =
    /\b(mqtt|esp32|ct sensor|current transformer|pairing|pair a device|firmware|subscription|plan|appliance|switch|wattbot|notification|alert threshold|power vs energy|voltage|supported sensor)\b/i.test(
      question,
    );
  if (!asksProductQuestion || matches.length === 0) return null;

  const relevant = matches.slice(0, 2);
  return [
    ...relevant.map((chunk) => `${chunk.content} _Source: ${chunk.source}_`),
    "If your question depends on a specific device or account setting, I can only confirm it from that household's stored data.",
  ].join('\n\n');
}
