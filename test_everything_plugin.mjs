// 模拟 Cordis 环境测试 dsh-tool-everything 插件
// 运行前提：本脚本所在目录能解析 koffi（如 C:\Users\roxyy\.dsh\profiles）
import * as plugin from 'dsh-tool-everything/lib/index.js';

const registered = [];
const mockCtx = {
  tools: { register: (tool) => registered.push(tool) },
  systemPrompt: { section: (s) => console.log('[systemPrompt]', s.name) }
};

await plugin.apply(mockCtx, { maxResults: 10, timeoutMs: 30000 });

console.log('registered tools:', registered.map(t => t.name));
const tool = registered[0];
const exec = { signal: new AbortController().signal, name: 'everything_search', callId: 'test-1', agent: {} };

const args = { search: 'npm', maxResults: 5 };
const result = await tool.execute(args, exec);
console.log('execute: total =', result.total, 'truncated =', result.truncated, 'items =', result.items.length);
for (const it of result.items) console.log(`  [${it.folder ? 'DIR' : it.size}] ${it.path}`);

console.log('--- render ---');
console.log(tool.output.render(args, result)[0].text);

const meta = tool.output.presentationMeta(args, result);
console.log('--- meta ---', JSON.stringify(meta));
console.log('--- presentResult ---', JSON.stringify(tool.presentResult(args, { isError: false, meta })));

const empty = await tool.execute({ search: 'zzz_no_such_file_xyz', maxResults: 5 }, exec);
console.log('empty search: total =', empty.total, 'items =', empty.items.length);
console.log(JSON.stringify(empty));

// 非法参数
try {
  await tool.execute({ search: '   ', maxResults: 5 }, exec);
  console.log('ERROR: blank search should have thrown');
} catch (e) {
  console.log('blank search rejected:', e.message);
}
