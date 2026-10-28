#!/usr/bin/env node
/**
 * PR 档轻量矩阵门禁：
 *
 * 跑 compileJava + processResources + jar（2-6 分钟/组合），不写回 manifest，
 * 用于 PR 路径拦住「创建即崩」类回归（如 NeoForge 双重 META-INF/ 前缀）。
 * 覆盖范围可用 KY_MATRIX_TIERS 覆盖（逗号分隔，如 core / core,extended）。
 */
process.env.KY_MATRIX_GATE = '1'
process.env.KY_MATRIX_PR = '1'
process.argv.splice(2, 0, 'run', 'src/main/services/ai/__tests__/matrixGate.spec.ts')
require('./run-vitest.cjs')
