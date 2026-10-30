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
const parseRpc = text => {
  try { return JSON.parse(text); }
  catch { return JSON.parse(text.split('\n').find(line => line.startsWith('data:')).slice(5)); }
};
const tools = parseRpc(text).result.tools;
assert.equal(tools.length, 6);
const realtime = tools.find(tool => tool.name === 'get_realtime_trends').inputSchema;
assert.deepEqual(realtime.properties.lang.enum, ['ko', 'en']);
assert.equal(realtime.properties.lang.default, 'ko');
assert.equal(realtime.properties.limit.minimum, 1);
assert.equal(realtime.properties.limit.maximum, 20);
assert.equal(realtime.properties.limit.default, 10);
const keyword = tools.find(tool => tool.name === 'get_keyword_detail').inputSchema;
assert.equal(keyword.properties.keyword.maxLength, 80);
// These must fail schema validation before any tool callback can access the DB.
for (const [name, args] of [
  ['get_realtime_trends', { lang: 'invalid', limit: 1 }],
  ['get_realtime_trends', { limit: 21 }],
  ['get_realtime_trends', { limit: 1.5 }],
  ['get_keyword_detail', { keyword: 'x'.repeat(81) }],
  ['search_trends', { query: '' }],
]) {
  const invalid = parseRpc(await (await POST(request({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } }))).text());
  assert.ok(invalid.error?.code === -32602 || invalid.result?.isError === true);
  assert.match(JSON.stringify(invalid), /Input validation error|Invalid arguments/i);
}
const tooLarge = await POST(request({ content: 'x'.repeat(40 * 1024) }));
assert.equal(tooLarge.status, 413);
const elements = await POST(request({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
  name: 'get_realtime_trends', arguments: { large: Array(2000).fill(1) },
} }));
const rejected = await elements.text();
assert.match(rejected, /maximum of 1000 elements/i);
console.log('PASS: six MCP tools; schema defaults/bounds; invalid arguments; body cap; SDK argument complexity cap');
// mcp-handler owns a process-wide session cleanup interval with no exported
// teardown. All assertions above are awaited; terminate this isolated CLI probe
// so a successful verification does not keep a CI worker alive indefinitely.
process.exit(0);
