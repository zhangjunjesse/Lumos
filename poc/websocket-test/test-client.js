import WebSocket from 'ws';
import { EventEmitter } from 'events';

class FeishuWebSocketClient extends EventEmitter {
  constructor(appId, appSecret) {
    super();
    this.appId = appId;
    this.appSecret = appSecret;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.isManualClose = false;
    this.stats = {
      connectTime: null,
      disconnectCount: 0,
      messageCount: 0,
      errors: []
    };
  }

  async connect() {
    try {
      const endpoint = await this.getWebSocketEndpoint();
      this.ws = new WebSocket(endpoint);

      this.ws.on('open', () => this.handleOpen());
      this.ws.on('message', (data) => this.handleMessage(data));
      this.ws.on('error', (error) => this.handleError(error));
      this.ws.on('close', (code, reason) => this.handleClose(code, reason));

    } catch (error) {
      this.logError('Connection failed', error);
      this.scheduleReconnect();
    }
  }

  async getWebSocketEndpoint() {
    const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret })
    });

    const { tenant_access_token } = await tokenRes.json();

    const wsRes = await fetch('https://open.feishu.cn/open-apis/im/v1/stream/open', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tenant_access_token}`,
        'Content-Type': 'application/json'
      }
    });

    const { data } = await wsRes.json();
    return data.url;
  }

  handleOpen() {
    this.stats.connectTime = new Date();
    this.reconnectAttempts = 0;
    this.log('Connected');
    this.emit('connected');
  }

  handleMessage(data) {
    this.stats.messageCount++;
    const message = JSON.parse(data.toString());
    this.log(`Message received: ${message.type}`);
    this.emit('message', message);
  }

  handleError(error) {
    this.logError('WebSocket error', error);
  }

  handleClose(code, reason) {
    this.stats.disconnectCount++;
    this.log(`Disconnected: ${code} - ${reason}`);

    if (!this.isManualClose) {
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logError('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => this.connect(), delay);
  }

  close() {
    this.isManualClose = true;
    if (this.ws) {
      this.ws.close();
    }
  }

  log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
  }

  logError(message, error) {
    const timestamp = new Date().toISOString();
    const errorMsg = `[${timestamp}] ERROR: ${message} - ${error?.message || error}`;
    console.error(errorMsg);
    this.stats.errors.push({ timestamp, message, error: error?.message });
  }

  getStats() {
    const uptime = this.stats.connectTime
      ? Math.floor((Date.now() - this.stats.connectTime.getTime()) / 1000)
      : 0;

    return {
      ...this.stats,
      uptime,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

// Test runner
async function runTest() {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;

  if (!appId || !appSecret) {
    console.error('Please set FEISHU_APP_ID and FEISHU_APP_SECRET');
    process.exit(1);
  }

  const client = new FeishuWebSocketClient(appId, appSecret);

  client.on('connected', () => {
    console.log('✓ Connection established');
  });

  client.on('message', (msg) => {
    console.log('✓ Message:', JSON.stringify(msg, null, 2));
  });

  // Stats reporter
  setInterval(() => {
    const stats = client.getStats();
    console.log('\n--- Stats ---');
    console.log(`Uptime: ${stats.uptime}s`);
    console.log(`Messages: ${stats.messageCount}`);
    console.log(`Disconnects: ${stats.disconnectCount}`);
    console.log(`Errors: ${stats.errors.length}`);
    console.log('-------------\n');
  }, 60000);

  await client.connect();

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    const stats = client.getStats();
    console.log('Final stats:', JSON.stringify(stats, null, 2));
    client.close();
    process.exit(0);
  });
}

runTest();
