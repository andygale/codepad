/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.addColumns('rooms', {
    language: { 
      type: 'varchar(50)', 
      notNull: true, 
      default: 'deno' 
    },
    code: { 
      type: 'text', 
      notNull: true, 
      default: 'class Greeter {\n  message: string;\n  constructor(message: string) {\n    this.message = message;\n  }\n  greet(): void {\n    console.log(this.message);\n  }\n}\n\nconst greeter = new Greeter(\'Hello, world!\');\ngreeter.greet();' 
    }
  });
};

exports.down = pgm => {
  pgm.dropColumns('rooms', ['language', 'code']);
};
