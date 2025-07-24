/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.createTable('user_events', {
    id: 'id',
    room_id: {
      type: 'integer',
      notNull: true,
      references: 'rooms',
      onDelete: 'cascade'
    },
    user_name: { type: 'varchar(255)', notNull: true },
    user_id: { type: 'varchar(255)', notNull: false }, // null for guests
    event_type: { 
      type: 'varchar(50)', 
      notNull: true,
      comment: 'Types: focus_gained, focus_lost, paste'
    },
    event_data: { 
      type: 'jsonb', 
      notNull: false,
      comment: 'Additional event data like character count for paste events'
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });
  
  // Create index for efficient querying by room_id
  pgm.createIndex('user_events', 'room_id');
  
  // Create index for efficient ordering by created_at
  pgm.createIndex('user_events', ['room_id', 'created_at']);
  
  // Create index for event_type queries
  pgm.createIndex('user_events', ['room_id', 'event_type']);
};

exports.down = pgm => {
  pgm.dropTable('user_events');
}; 