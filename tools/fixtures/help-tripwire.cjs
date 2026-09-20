// Loaded only by source_help.test.ts subprocesses, never by production CLIs.
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const logFd = fs.openSync(process.env.HELP_AUDIT_LOG, 'a');
const write = fs.writeSync.bind(fs);
function deny(kind) {
  return function () {
    write(logFd, kind + '\n');
    process.stderr.write('HELP_AUDIT_EFFECT: ' + kind + '\n');
    process.exit(91);
  };
}
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  require('node:child_process')[name] = deny('process:' + name);
}
for (const module of ['node:net', 'node:tls', 'node:http', 'node:https', 'node:http2', 'node:dgram']) {
  const object = require(module);
  for (const name of ['connect', 'createConnection', 'request', 'get', 'createSocket', 'createServer']) {
    if (typeof object[name] === 'function') object[name] = deny('network:' + module + ':' + name);
  }
}
require('node:net').Socket.prototype.connect = deny('network:socket');
global.fetch = deny('network:fetch');
for (const name of ['writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'rm', 'rmdir', 'unlink', 'rename', 'copyFile', 'cp', 'chmod', 'chown', 'truncate', 'utimes', 'symlink', 'link', 'write', 'writev']) {
  for (const suffix of ['', 'Sync']) if (fs[name + suffix]) fs[name + suffix] = deny('write:' + name + suffix);
  if (fs.promises[name]) fs.promises[name] = deny('write:promises.' + name);
}
for (const name of ['open', 'openSync']) {
  const original = fs[name].bind(fs);
  fs[name] = function (file, flags, ...rest) {
    if (flags !== 'r' && flags !== 0) return deny('write:' + name)();
    return original(file, flags, ...rest);
  };
}
fs.createWriteStream = deny('write:createWriteStream');
// An empty disposable HOME alone would hide a credential/config read. Record it.
for (const name of ['readFileSync', 'readFile', 'createReadStream']) {
  const original = fs[name].bind(fs);
  fs[name] = function (file, ...rest) {
    if (String(file).startsWith(process.env.HOME + '/')) return deny('home-read:' + name)();
    return original(file, ...rest);
  };
}
process.dlopen = deny('native:dlopen');
syncBuiltinESMExports();
