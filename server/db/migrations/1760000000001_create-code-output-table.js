/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.createTable('code_outputs', {
    id: 'id',
    room_id: {
      type: 'integer',
      notNull: true,
      references: 'rooms',
      onDelete: 'cascade'
    },
    output: { type: 'text', notNull: true },
    exec_time_ms: { type: 'integer', notNull: false },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });
  
  // Create index for efficient querying by room_id
  pgm.createIndex('code_outputs', 'room_id');
  
  // Create index for efficient ordering by created_at
  pgm.createIndex('code_outputs', ['room_id', 'created_at']);
};

exports.down = pgm => {
  pgm.dropTable('code_outputs');
}; 