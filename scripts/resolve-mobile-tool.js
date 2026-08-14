#!/usr/bin/env node
const { resolveAdb, resolveMaestro, resolveXcrun } = require('./lib/mobile-tools');

const tool = process.argv[2];
const resolved = tool === 'adb'
  ? resolveAdb()
  : tool === 'maestro'
    ? resolveMaestro()
    : tool === 'xcrun'
      ? resolveXcrun()
      : undefined;

if (!resolved) {
  console.error(`Ferramenta não encontrada: ${tool || '<ausente>'}`);
  process.exit(1);
}
console.log(resolved);
