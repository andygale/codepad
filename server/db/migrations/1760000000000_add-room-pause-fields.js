/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.addColumns('rooms', {
    is_paused: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    last_activity_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    paused_at: {
      type: 'timestamp',
      notNull: false,
    },
  });
  
  // Create index for efficient querying of rooms that need to be auto-paused
  pgm.createIndex('rooms', 'last_activity_at');
};

exports.down = pgm => {
  pgm.dropIndex('rooms', 'last_activity_at');
  pgm.dropColumns('rooms', ['is_paused', 'last_activity_at', 'paused_at']);
}; 