// No external calls: tools/list does not read DB; malformed tools/call fails in SDK validation.
import assert from 'node:assert/strict';
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
process.env.POSTGRES_URL = process.env.DATABASE_URL;
const { POST } = await import('../src/app/api/mcp/[transport]/route.ts');
const request = body => new Request('http://localhost/api/mcp/mcp', {
  method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(body),
});
const response = await POST(request({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }));
assert.equal(response.status, 200);
const text = await response.text();
assert.match(text, /get_realtime_trends/);
const tooLarge = await POST(request({ content: 'x'.repeat(40 * 1024) }));
assert.equal(tooLarge.status, 413);
const elements = await POST(request({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
  name: 'get_realtime_trends', arguments: { large: Array(2000).fill(1) },
} }));
const rejected = await elements.text();
assert.match(rejected, /maximum of 1000 elements/i);
console.log('PASS: MCP tool discovery; body cap; SDK argument complexity cap');
// mcp-handler owns a process-wide session cleanup interval with no exported
// teardown. All assertions above are awaited; terminate this isolated CLI probe
// so a successful verification does not keep a CI worker alive indefinitely.
process.exit(0);
