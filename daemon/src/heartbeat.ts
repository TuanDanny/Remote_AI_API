import { SupabaseClient } from '@supabase/supabase-js';

export interface HeartbeatOptions {
  intervalMs?: number;
  registerSignalHandlers?: boolean;
  onExit?: () => void | Promise<void>;
}

export class HeartbeatService {
  private client: SupabaseClient;
  private deviceId: string;
  private deviceName: string;
  private workingDirectory: string;
  private timer: NodeJS.Timeout | null = null;
  private sigintHandler?: () => Promise<void>;
  private sigtermHandler?: () => Promise<void>;

  constructor(client: SupabaseClient, deviceId: string, deviceName: string, workingDirectory: string) {
    this.client = client;
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.workingDirectory = workingDirectory;
  }

  async start(options?: HeartbeatOptions): Promise<void> {
    // Initial upsert
    await this.ping('online');

    const interval = options?.intervalMs ?? 10000;
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = setInterval(() => {
      this.ping('online').catch((err: any) => {
        console.error('[Heartbeat] Ping error:', err?.message || err);
      });
    }, interval);

    if (options?.registerSignalHandlers !== false) {
      const onExit = async () => {
        await this.stop();
        if (options?.onExit) {
          await options.onExit();
        } else {
          process.exit(0);
        }
      };

      this.sigintHandler = onExit;
      this.sigtermHandler = onExit;

      process.on('SIGINT', this.sigintHandler);
      process.on('SIGTERM', this.sigtermHandler);
    }
  }

  async ping(status: 'online' | 'offline'): Promise<void> {
    try {
      await this.client.from('devices').upsert({
        id: this.deviceId,
        name: this.deviceName,
        status,
        working_directory: this.workingDirectory,
        last_heartbeat: new Date().toISOString()
      });
    } catch (err: any) {
      console.error('[Heartbeat] Ping error:', err?.message || err);
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.sigintHandler) {
      process.off('SIGINT', this.sigintHandler);
      this.sigintHandler = undefined;
    }
    if (this.sigtermHandler) {
      process.off('SIGTERM', this.sigtermHandler);
      this.sigtermHandler = undefined;
    }
    await this.ping('offline');
  }

  getTimer(): NodeJS.Timeout | null {
    return this.timer;
  }
}
