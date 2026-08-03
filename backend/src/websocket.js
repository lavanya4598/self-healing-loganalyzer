const WebSocket = require('ws');
const logger = require('./logger');
const store = require('./store');

let wss = null;

function initWebSocket(server) {
  wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const remoteAddress = req.socket.remoteAddress;
    logger.info(`WebSocket client connected from ${remoteAddress}`);
    store.audit.push({ event: 'ws_connected', user: 'system', remoteAddress, timestamp: new Date().toISOString() });
    ws.send(JSON.stringify({ type: 'connected', message: 'Connected to Self-Healing Log Analyser' }));

    ws.on('close', () => {
      logger.debug('WebSocket client disconnected');
      store.audit.push({ event: 'ws_disconnected', user: 'system', remoteAddress, timestamp: new Date().toISOString() });
    });

    ws.on('error', (err) => {
      logger.error(`WebSocket error: ${err.message}`);
    });
  });

  logger.info('WebSocket server initialised on /ws');
}

function broadcastEvent(eventType, payload) {
  if (!wss) return;
  const message = JSON.stringify({ type: eventType, data: payload, timestamp: new Date().toISOString() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

module.exports = { initWebSocket, broadcastEvent };
