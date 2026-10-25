import { test, describe } from 'node:test';
import assert from 'node:assert';
import { SessionDiscoveryService } from '../src/sessionDiscovery.js';

describe('SessionDiscoveryService Suite', () => {
  const mockSupabase: any = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null })
          })
        })
      }),
      insert: () => ({
        select: () => ({
          single: async () => ({ data: { id: 'mock-session-id' }, error: null })
        })
      })
    })
  };

  test('SessionDiscoveryService instantiates properly', () => {
    const service = new SessionDiscoveryService(mockSupabase, 'win11-main');
    assert.ok(service);
  });

  test('discoverClaudeDesktopSessions returns array without throwing', async () => {
    const service = new SessionDiscoveryService(mockSupabase, 'win11-main');
    const sessions = await service.discoverClaudeDesktopSessions();
    assert.ok(Array.isArray(sessions));
  });

  test('discoverCodexSessions returns array without throwing', async () => {
    const service = new SessionDiscoveryService(mockSupabase, 'win11-main');
    const sessions = await service.discoverCodexSessions();
    assert.ok(Array.isArray(sessions));
  });
});
