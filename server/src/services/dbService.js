const { Pool } = require('pg');
const config = require('../config');

class DbService {
  constructor() {
    if (!DbService.instance) {
      this.pool = new Pool({
        connectionString: config.databaseUrl,
        ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: false } : false
      });

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