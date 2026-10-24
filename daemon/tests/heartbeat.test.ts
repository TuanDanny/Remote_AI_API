import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { HeartbeatService } from '../src/heartbeat.js';
import type { SupabaseClient } from '@supabase/supabase-js';

interface UpsertRecord {
  table: string;
  data: {
    id: string;
    name: string;
    status: 'online' | 'offline';
    working_directory: string;
    last_heartbeat: string;
  };
}

function createMockSupabaseClient() {
  const upsertRecords: UpsertRecord[] = [];
  let shouldFail = false;
  let failureError: Error = new Error('Database connection failed');

  const client = {
    from: (table: string) => ({
      upsert: async (data: any) => {
        upsertRecords.push({ table, data });
        if (shouldFail) {
          return { error: failureError, data: null };
        }
        return { error: null, data };
      }
    }),
    _getUpserts: () => upsertRecords,
    _setShouldFail: (fail: boolean, err?: Error) => {
      shouldFail = fail;
      if (err) failureError = err;
    }
  };

  return client;
}

describe('HeartbeatService Suite', () => {
  const deviceId = 'test-pc-01';
  const deviceName = 'Test Machine';
  const workingDir = 'D:\\Project\\RemoteAI';

  let mockClient: ReturnType<typeof createMockSupabaseClient>;
  let heartbeat: HeartbeatService;

  beforeEach(() => {
    mockClient = createMockSupabaseClient();
    heartbeat = new HeartbeatService(
      mockClient as unknown as SupabaseClient,
      deviceId,
      deviceName,
      workingDir
    );
  });

  test('ping(online) upserts device record with online status and timestamp', async () => {
    await heartbeat.ping('online');

    const upserts = mockClient._getUpserts();
    assert.strictEqual(upserts.length, 1);
    assert.strictEqual(upserts[0].table, 'devices');
    assert.strictEqual(upserts[0].data.id, deviceId);
    assert.strictEqual(upserts[0].data.name, deviceName);
    assert.strictEqual(upserts[0].data.status, 'online');
    assert.strictEqual(upserts[0].data.working_directory, workingDir);
    assert.ok(Date.parse(upserts[0].data.last_heartbeat) > 0);
  });

  test('ping(offline) upserts device record with offline status', async () => {
    await heartbeat.ping('offline');

    const upserts = mockClient._getUpserts();
    assert.strictEqual(upserts.length, 1);
    assert.strictEqual(upserts[0].table, 'devices');
    assert.strictEqual(upserts[0].data.id, deviceId);
    assert.strictEqual(upserts[0].data.status, 'offline');
  });

  test('setWorkingDirectory updates working directory dynamically', async () => {
    assert.strictEqual(heartbeat.getWorkingDirectory(), workingDir);
    const newDir = 'D:\\Project\\AW-Car';
    heartbeat.setWorkingDirectory(newDir);
    assert.strictEqual(heartbeat.getWorkingDirectory(), newDir);

    await heartbeat.ping('online');
    const upserts = mockClient._getUpserts();
    const last = upserts[upserts.length - 1];
    assert.strictEqual(last.data.working_directory, newDir);
  });

  test('start() immediately pings online and sets up periodic interval timer', async () => {
    await heartbeat.start({ intervalMs: 50, registerSignalHandlers: false });

    // Initial ping should have fired immediately
    const upsertsAfterStart = mockClient._getUpserts();
    assert.strictEqual(upsertsAfterStart.length, 1);
    assert.strictEqual(upsertsAfterStart[0].data.status, 'online');
    assert.ok(heartbeat.getTimer() !== null);

    // Wait for at least 2 interval ticks (50ms each)
    await new Promise((resolve) => setTimeout(resolve, 140));

    const upsertsAfterWait = mockClient._getUpserts();
    // 1 initial + at least 2 periodic ticks
    assert.ok(
      upsertsAfterWait.length >= 3,
      `Expected at least 3 pings, got ${upsertsAfterWait.length}`
    );
    for (const record of upsertsAfterWait) {
      assert.strictEqual(record.data.status, 'online');
    }

    await heartbeat.stop();
  });

  test('stop() clears timer and sends offline status', async () => {
    await heartbeat.start({ intervalMs: 50, registerSignalHandlers: false });
    assert.ok(heartbeat.getTimer() !== null);

    await heartbeat.stop();

    assert.strictEqual(heartbeat.getTimer(), null);
    const upserts = mockClient._getUpserts();
    const lastRecord = upserts[upserts.length - 1];
    assert.strictEqual(lastRecord.data.status, 'offline');

    // Wait a bit to ensure no more ticks fire after stop
    const countAtStop = upserts.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.strictEqual(mockClient._getUpserts().length, countAtStop);
  });

  test('graceful shutdown triggers stop and offline ping via onExit callback', async () => {
    let exitCalled = false;

    await heartbeat.start({
      intervalMs: 1000,
      registerSignalHandlers: true,
      onExit: () => {
        exitCalled = true;
      }
    });

    // Simulate SIGTERM event
    process.emit('SIGTERM');

    // Yield to let the async onExit handler resolve
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.strictEqual(exitCalled, true);
    assert.strictEqual(heartbeat.getTimer(), null);

    const upserts = mockClient._getUpserts();
    const lastRecord = upserts[upserts.length - 1];
    assert.strictEqual(lastRecord.data.status, 'offline');
  });

  test('ping handles Supabase errors gracefully without throwing', async () => {
    mockClient._setShouldFail(true);

    // Should not throw
    await assert.doesNotReject(async () => {
      await heartbeat.ping('online');
    });

    const upserts = mockClient._getUpserts();
    assert.strictEqual(upserts.length, 1);
  });

  test('ping handles unexpected exceptions gracefully without throwing', async () => {
    const throwingClient = {
      from: () => {
        throw new Error('Unexpected network exception');
      }
    };

    const faultyHeartbeat = new HeartbeatService(
      throwingClient as unknown as SupabaseClient,
      deviceId,
      deviceName,
      workingDir
    );

    // Should catch and not throw
    await assert.doesNotReject(async () => {
      await faultyHeartbeat.ping('online');
    });
  });
});
