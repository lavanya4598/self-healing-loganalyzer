require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { port } = require('./config');
const logger = require('./logger');
const errorHandler = require('./middleware/errorHandler');
const { initWebSocket } = require('./websocket');
const { startLogCollector } = require('./logCollector');
const { startServiceMonitor } = require('./serviceMonitor');
const { startDefunctProcessMonitor } = require('./defunctProcessMonitor');

// Routes
const authRoutes = require('./routes/auth');
const logsRoutes = require('./routes/logs');
const anomaliesRoutes = require('./routes/anomalies');
const approvalsRoutes = require('./routes/approvals');
const dashboardRoutes = require('./routes/dashboard');

const app = express();

// ─── Security middleware ───────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 500 : 5000,
  message: { error: 'Too many requests' },
}));

// ─── Parsing & logging ────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'backend', timestamp: new Date().toISOString() }));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/anomalies', anomaliesRoutes);
app.use('/api/approvals', approvalsRoutes);
app.use('/api/dashboard', dashboardRoutes);

// ─── Error handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── HTTP + WebSocket server ──────────────────────────────────────────────────
const server = http.createServer(app);
initWebSocket(server);

server.listen(port, () => {
  logger.info(`Backend API listening on http://localhost:${port}`);
  logger.info(`WebSocket available at ws://localhost:${port}/ws`);
  startLogCollector();
  startServiceMonitor();
  startDefunctProcessMonitor();
});
