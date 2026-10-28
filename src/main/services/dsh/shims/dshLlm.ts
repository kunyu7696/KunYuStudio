/**
 * Shim：@deepseek-ai/dsh-llm（dsh-pet 未公开 peer 包）
 * 语义照抄原作 standalone.js 内联实现（权威来源）：
 * 消息形态 {role, content(块数组), source}；chunk 仅收 {type:"text", text}。
 */
export const dshLlmShim = [
  '// kunyu DSH 兼容宿主本地桩：照抄 dsh-pet standalone.js 的内联实现（权威语义）',
  '// 消息形态 {role, content(块数组), source}；chunk 仅收 {type:"text", text}',
  'function createUserMessage(input) {',
  '  return { role: "user", content: input.content, source: input.source }',
  '}',
  'function createAssistantMessage(input) {',
  '  return { role: "assistant", content: input.content, source: input.source }',
  '}',
  'var BlockAssembler = class {',
  '  chunks = []',
  '  push(chunk) {',
  '    if (chunk !== null && typeof chunk === "object" && chunk.type === "text") {',
  '      const text = chunk.text',
  '      if (typeof text === "string") this.chunks.push(text)',
  '    }',
  '  }',
  '  blocks() {',
  '    const text = this.chunks.join("")',
  '    return text === "" ? [] : [{ type: "text", text }]',
  '  }',
  '}',
  'function ReasoningEffortId(id) {',
  '  return id',
  '}',
  'export { BlockAssembler, ReasoningEffortId, createAssistantMessage, createUserMessage }',
  ''
].join('\n')
