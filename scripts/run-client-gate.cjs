#!/usr/bin/env node
/**
 * 客户端进游戏门禁入口（Stage 2：客户端进游戏）。
 *
 * 设 KY_CLIENT_GATE=1 后复用统一 vitest 入口，只跑 clientGate.spec：
 * 对版本族代表组执行 createProject → generateContent（含实体）→ gradlew runServer
 * 生成平地世界 → gradlew runClient --quickPlaySingleplayer，在 Xvfb 虚拟显示下
 * 等待集成服务器 Done，抓屏留证后写回 overlay 的 matrixHealth.stages.runtime。
 *
 * 必须运行在 Linux + 虚拟显示下（CI 用 xvfb-run；本机手动同样需要）。
 * 覆盖范围可用 KY_CLIENT_COMBOS 覆盖（逗号分隔，如 fabric-1.21.11）。
 * workflow 负责导出 overlay 到 manifest 并提交。
 */
if (process.platform !== 'linux') {
  console.error('[client-gate] 客户端门禁依赖 Xvfb / x11grab，仅支持 Linux')
  process.exit(1)
}
if (!process.env.DISPLAY) {
  console.error(
    '[client-gate] 缺少 DISPLAY：请用 xvfb-run -a --server-args="-screen 0 1280x720x24" npm run test:client'
  )
  process.exit(1)
}
process.env.KY_CLIENT_GATE = '1'
process.argv.splice(2, 0, 'run', 'src/main/services/ai/__tests__/clientGate.spec.ts')
require('./run-vitest.cjs')
