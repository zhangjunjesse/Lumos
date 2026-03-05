import { app } from 'electron';
import WebSocket from 'ws';

class ElectronWebSocketTest {
  constructor(appId, appSecret) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.ws = null;
    this.stats = {
      startTime: Date.now(),
      messageCount: 0,
      reconnectCount: 0,
      errors: [],
      latencies: []
    };
  }

  async getToken() {
    const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret
      })
    });
    const data = await res.json();
    return data.tenant_access_token;
  }

  async getEndpoint(token) {
    const res = await fetch('https://open.feishu.cn/open-apis/im/v1/stream/open', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await res.json();
    return data.data.url;
  }

  async connect() {
    try {
      const token = await this.getToken();
      const endpoint = await this.getEndpoint(token);

      this.ws = new WebSocket(endpoint);

      this.ws.on('open', () => {
        console.log('[Electron] WebSocket connected');
      });

      this.ws.on('message', (data) => {
        this.stats.messageCount++;
        const latency = Date.now() - this.stats.startTime;
        this.stats.latencies.push(latency);
        console.log(`[Electron] Message #${this.stats.messageCount}`);
      });

      this.ws.on('error', (err) => {
        this.stats.errors.push({ time: Date.now(), error: err.message });
        console.error('[Electron] Error:', err.message);
      });

      this.ws.on('close', () => {
        this.stats.reconnectCount++;
        console.log('[Electron] Disconnected, reconnecting...');
        setTimeout(() => this.connect(), 5000);
      });

    } catch (err) {
      this.stats.errors.push({ time: Date.now(), error: err.message });
      console.error('[Electron] Connection failed:', err.message);
      setTimeout(() => this.connect(), 5000);
    }
  }

  getReport() {
    const uptime = Math.floor((Date.now() - this.stats.startTime) / 1000);
    const avgLatency = this.stats.latencies.length > 0
      ? Math.floor(this.stats.latencies.reduce((a, b) => a + b, 0) / this.stats.latencies.length)
      : 0;

    return {
      uptime: `${uptime}s`,
      messages: this.stats.messageCount,
      reconnects: this.stats.reconnectCount,
      errors: this.stats.errors.length,
      avgLatency: `${avgLatency}ms`,
      successRate: this.stats.reconnectCount > 0
        ? `${Math.floor((1 - this.stats.errors.length / this.stats.reconnectCount) * 100)}%`
        : '100%'
    };
  }
}

app.whenReady().then(async () => {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;

  if (!appId || !appSecret) {
    console.error('Missing FEISHU_APP_ID or FEISHU_APP_SECRET');
    app.quit();
    return;
  }

  const test = new ElectronWebSocketTest(appId, appSecret);
  await test.connect();

  setInterval(() => {
    console.log('\n=== Report ===');
    console.log(JSON.stringify(test.getReport(), null, 2));
    console.log('==============\n');
  }, 300000); // Every 5 minutes

  app.on('before-quit', () => {
    console.log('\n=== Final Report ===');
    console.log(JSON.stringify(test.getReport(), null, 2));
  });
});
