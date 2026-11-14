import { describe, expect, it } from 'vitest';
import { answerFromKnowledge, retrieveKnowledge } from '../src/services/wattbot/knowledge';

describe('WattBot knowledge retrieval', () => {
  it('retrieves the verified MQTT contract for MQTT questions', () => {
    const results = retrieveKnowledge('What MQTT topic should my ESP32 publish telemetry to?');
    expect(results[0]?.source).toBe('docs/HARDWARE.md');
    expect(results[0]?.content).toContain('MQTT topics');
  });

  it('surfaces the whole-house CT appliance attribution limit', () => {
    const results = retrieveKnowledge('Can a CT sensor tell me which appliance used energy?');
    expect(results.some((chunk) => chunk.content.includes('cannot identify individual appliances'))).toBe(true);
  });

  it('does not attach unrelated product documentation', () => {
    expect(retrieveKnowledge('What color is my kitchen wall?')).toEqual([]);
  });

  it('uses cited product documentation instead of guessing when no provider is configured', () => {
    const question = 'Can WattNexa switch an appliance off?';
    const answer = answerFromKnowledge(question, retrieveKnowledge(question));
    expect(answer).toContain('does not implement smart appliance switching');
    expect(answer).toContain('docs/HARDWARE.md');
  });
});
