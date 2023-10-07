const parse = require('mrz').parse;

let mrz = ["POCHNXIA<<WEICHAO<<<<<<<<<<<<<<<<<<<<<<<<<<<",
"EC59070674CHN9009109F2803010MPMEMNP0LDKMA960"];

var result = parse(mrz);
console.log(result);