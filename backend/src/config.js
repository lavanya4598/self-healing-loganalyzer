require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3001,
  jwtSecret: process.env.JWT_SECRET || 'changeme',
  jwtExpiry: process.env.JWT_EXPIRY || '8h',
  aiServiceUrl: process.env.AI_SERVICE_URL || 'http://localhost:8001',
  nodeEnv: process.env.NODE_ENV || 'development',

  // Approval level role mapping. L1 is auto-approved (attributed to
  // Application Support, no human action needed). L2 needs any ONE of the
  // listed roles. L3 lists more than one role, which is treated as
  // requiring ALL of them to individually sign off (see routes/approvals.js)
  // before the action is fully approved and auto-execution can proceed.
  approvalRoles: {
    L1: [],                          // auto-approved, no human needed
    L2: ['sdm'],                     // Service Delivery Manager approval is sufficient
    L3: ['sdm', 'sm', 'im'],         // Service Delivery Manager, Service Manager & Incident Manager must ALL approve
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

