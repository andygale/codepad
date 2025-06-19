const path = require('path');
const pgMigrate = require('node-pg-migrate').default;
const config = require('../config');

const runMigrations = async () => {
  try {
    console.log('Running database migrations...');
    await pgMigrate({
      databaseUrl: config.databaseUrl,
      dbClient: 'pg',
      dir: path.join(__dirname, 'migrations'),
      direction: 'up',
      migrationsTable: 'pgmigrations',
      verbose: true,
      ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: false } : false
    });
    console.log('Migrations completed successfully.');
  } catch (err) {
    console.error('Error running migrations:', err);
    process.exit(1);
  }
};

runMigrations(); 