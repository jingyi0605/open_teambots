import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { referenceTools } from '../../../_shared/reference';

test('The stdio server lists exactly the pinned tools plus read_result and validates input', async () => {
  const client = new Client({ name: 'sheets-smoke', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(import.meta.dir, '..', 'server.ts')], env: { GOOGLE_ACCESS_TOKEN: '' }, stderr: 'pipe' });
  await client.connect(transport);
  try {
    const tools = (await client.listTools()).tools;
    expect(tools.map(t => t.name).sort()).toEqual([...referenceTools.sheets.map(t => t.name), 'read_result'].sort());
    const invalid = await client.callTool({ name: 'read_range', arguments: { spreadsheetId: 'x', ranges: [], unexpected: true } });
    expect(invalid.isError).toBe(true);
    expect(JSON.stringify(invalid)).toContain('Invalid tool arguments');
    const unauthorized = await client.callTool({ name: 'get_spreadsheet', arguments: { spreadsheetId: 'x' } });
    expect(unauthorized.isError).toBe(true);
    expect(JSON.stringify(unauthorized)).toContain('not authorized');
  } finally { await client.close(); }
}, 20_000);
