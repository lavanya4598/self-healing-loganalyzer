require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3001,
  jwtSecret: process.env.JWT_SECRET || 'changeme',
  jwtExpiry: process.env.JWT_EXPIRY || '8h',
  aiServiceUrl: process.env.AI_SERVICE_URL || 'http://localhost:8001',
  nodeEnv: process.env.NODE_ENV || 'development',

  // Approval level role mapping
  approvalRoles: {
    L1: [],                          // auto-approved, no human needed
    L2: ['team_lead', 'admin'],      // requires team lead or admin
    L3: ['manager', 'admin'],        // requires manager or admin
  },

  // In-memory store keys
  storeKeys: {
    ANALYSES: 'analyses',
    ANOMALIES: 'anomalies',
    ACTIONS: 'actions',
    APPROVALS: 'approvals',
    PLANS: 'plans',
    USERS: 'users',
    AUDIT: 'audit',
  },
};

