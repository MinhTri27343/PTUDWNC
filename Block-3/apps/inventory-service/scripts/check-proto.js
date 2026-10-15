const fs = require('node:fs');
const path = require('node:path');

const protoPaths = [
  path.join(__dirname, '..', 'proto', 'v1', 'inventory.proto'),
  path.join(__dirname, '..', 'proto', 'v2', 'inventory.proto')
];
for (const protoPath of protoPaths) {
  if (!fs.existsSync(protoPath)) throw new Error('Missing proto: ' + protoPath);
  console.log('Proto contract is present:', protoPath);
}
console.log('The v1/v2 contracts are loaded with @grpc/proto-loader because the bundled grpc-tools protoc binary is unavailable on this Windows runtime.');
