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
// `flags` defaults to 'r' when omitted, and in the callback form the second
// argument IS the callback — reading either as a write would record a phantom
// effect for an ordinary read, which is a false red no reviewer can act on.
// fs.promises.open is wrapped too: it is a write door the list above misses.
const readOnlyOpen = (flags) => flags === undefined || typeof flags === 'function' || flags === 'r' || flags === 0;
for (const [object, name, label] of [[fs, 'open', 'open'], [fs, 'openSync', 'openSync'], [fs.promises, 'open', 'promises.open']]) {
  if (typeof object[name] !== 'function') continue;
  const original = object[name].bind(object);
  object[name] = function (file, flags, ...rest) {
    if (!readOnlyOpen(flags)) return deny('write:' + label)();
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
