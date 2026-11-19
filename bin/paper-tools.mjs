#!/usr/bin/env node
// Shared JSON tool client for shell-capable agents. No SDK or shell quoting of
// document content is required: arguments can come from stdin or a JSON file.
import fs from 'node:fs';

try {
  const [sessionFile, tool = 'help', argument] = process.argv.slice(2);
  if (!sessionFile) throw new Error('Usage: node paper-tools.mjs SESSION TOOL [JSON | @FILE | -]. Omit TOOL for tool schemas.');
  const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  const url = new URL(session.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/tools') throw new Error('Invalid local tool session.');
  const input = !argument ? '{}' : argument === '-' ? fs.readFileSync(0, 'utf8') : argument.startsWith('@') ? fs.readFileSync(argument.slice(1), 'utf8') : argument;
  const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ tool, arguments: JSON.parse(input) }) });
  const result = await response.text();
  process.stdout.write(result + '\n');
  if (!response.ok) process.exitCode = 1;
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
}
