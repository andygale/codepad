/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.addColumns('rooms', {
    creator: {
      type: 'varchar(255)',
      notNull: false, // Allow null for existing rooms
    },
  });
};

exports.down = pgm => {
  pgm.dropColumns('rooms', ['creator']);
}; 