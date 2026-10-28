#!/usr/bin/env node
/**
 * 矩阵门禁入口。
 *
 * 设 KY_MATRIX_GATE=1 后复用统一 vitest 入口，只跑 matrixGate.spec：
 * 对 core/extended 组合逐一执行「创建项目 → 注入快速内容 → 生成代码 → gradlew build」，
 * 结果写回 resources/ai-reference/manifest.json 的 matrixHealth。
 * 覆盖范围可用 KY_MATRIX_TIERS 覆盖（逗号分隔，如 core / core,extended）。
 */
process.env.KY_MATRIX_GATE = '1'
process.argv.splice(2, 0, 'run', 'src/main/services/ai/__tests__/matrixGate.spec.ts')
require('./run-vitest.cjs')
