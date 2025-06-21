/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('rooms', {
    creator_email: {
      type: 'varchar(255)',
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('rooms', 'creator_email');
};
