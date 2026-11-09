#!/usr/bin/env node
/**
 * Runtime 门禁入口（Stage 1：专用服务器加载）。
 *
 * 设 KY_RUNTIME_GATE=1 后复用统一 vitest 入口，只跑 runtimeGate.spec：
 * 对版本族代表组执行 createProject → generateContent（含实体）→ gradlew runServer，
 * 日志出现 Done 即通过，结果写回 overlay 的 matrixHealth.stages.load。
 * 覆盖范围可用 KY_RUNTIME_COMBOS 覆盖（逗号分隔，如 fabric-1.21.11）。
 * workflow 负责导出 overlay 到 manifest 并提交。
 */
process.env.KY_RUNTIME_GATE = '1'
process.argv.splice(2, 0, 'run', 'src/main/services/ai/__tests__/runtimeGate.spec.ts')
require('./run-vitest.cjs')
