const path = require('path');
// Load the shared root .env first (works regardless of the process cwd),
// then allow a local .env in this folder to override individual values.
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), override: true });

module.exports = {
  port: process.env.AI_SERVICE_PORT || 8001,

  googleApiKey: process.env.GOOGLE_API_KEY || '',
  googleModel: process.env.GOOGLE_MODEL || 'gemini-flash-latest',

  // Approval level is ALWAYS derived from this server-side whitelist, never
  // from anything the LLM returns - this prevents a prompt-injection attempt
  // (e.g. malicious text embedded in log lines) from downgrading the human
  // approval requirement for a risky action.
  actionLevels: {
    restart_service: 'L2',
    clear_cache: 'L1',
    scale_up: 'L3',
    rotate_credentials: 'L3',
    disk_cleanup: 'L2',
    config_update: 'L2',
    rollback_deployment: 'L3',
    alert_only: 'L1',
    auto_fix_code: 'L1',
    network_reset: 'L3',
  },
};
