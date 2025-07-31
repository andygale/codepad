const { Pool } = require('pg');
const config = require('../config');
const fs = require('fs');
const path = require('path');

class DbService {
  constructor() {
    if (!DbService.instance) {
      // In production, SSL is required unless explicitly disabled.
      const useSsl = config.nodeEnv === 'production' && process.env.DATABASE_SSL !== 'false';

      // Auto-detect if we're running in Docker and adjust database URL accordingly
      let databaseUrl = config.databaseUrl;
      
      // If we're in a Docker container and the URL contains 'localhost', 
      // replace it with 'host.docker.internal'
      if (process.env.HOSTNAME && databaseUrl.includes('localhost')) {
        databaseUrl = databaseUrl.replace('localhost', 'host.docker.internal');
        console.log('🐳 Detected Docker environment, using host.docker.internal for database connection');
      }

      const connectionConfig = {
        connectionString: databaseUrl,
      };

      // SECURITY: In production, enforce SSL and use the AWS RDS CA certificate for verification.
      if (useSsl) {
        const caPath = path.resolve(__dirname, '..', 'config', 'certs', 'aws-rds-global-bundle.pem');
        if (fs.existsSync(caPath)) {
          connectionConfig.ssl = {
            rejectUnauthorized: true, // This is the secure default, explicitly set for clarity.
            ca: fs.readFileSync(caPath).toString(),
          };
          console.log('Database SSL configured with AWS RDS CA certificate.');
        } else {
          console.error('FATAL: Could not find AWS RDS CA certificate. SSL cannot be configured securely.');
          connectionConfig.ssl = { rejectUnauthorized: false }; // Fallback for safety
        }
      } else {
        // For local development or when explicitly disabled, turn SSL off.
        connectionConfig.ssl = false;
        console.log('Database SSL has been explicitly disabled.');
      }

      this.pool = new Pool(connectionConfig);

      this.pool.on('error', (err, client) => {
        console.error('Unexpected error on idle client', err);
        process.exit(-1);
      });
      DbService.instance = this;
    }
    return DbService.instance;
  }

  getPool() {
    return this.pool;
  }

  async query(text, params) {
    const start = Date.now();
    const res = await this.pool.query(text, params);
    const duration = Date.now() - start;
    console.log('executed query', { text, duration, rows: res.rowCount });
    return res;
  }
}

const instance = new DbService();
Object.freeze(instance);

module.exports = instance; 