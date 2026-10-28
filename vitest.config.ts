import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// ESM 写法（import.meta.dirname）：esbuild 打包会注入 __dirname 垫片，
// 但 vite configLoader=runner/native 模式按真 ESM 执行，CJS 垫片不存在
const rootDir = resolve(import.meta.dirname)

// 环境分层：主进程/shared 逻辑涉及 fs/sqlite/child_process，
// 跑在 jsdom 下既慢又失真（环境被浏览器模拟接管）；仅 renderer 组件测试需要 DOM。
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@renderer': resolve(rootDir, 'src/renderer/src'),
      '@shared': resolve(rootDir, 'src/shared')
    }
  },
  test: {
    include: ['src/**/*.spec.ts'],
    // 组件与 store 单测不依赖 electron 主进程；window.api 由各 spec 自行打桩
    globals: false,
    restoreMocks: true,
    // 默认 node 环境（main/shared/preload 的真实运行环境）；
    // renderer 下的用例经 environmentMatchGlobs 切到 jsdom
    environment: 'node',
    environmentMatchGlobs: [['src/renderer/**', 'jsdom']],
    // 覆盖率：先对主进程服务层设软门槛，
    // 阈值取实测值向下取整（防大幅下跌，不卡小幅波动）；用 npm run test:coverage 触发
    // include 扩到 templates + ipc（此前只覆盖 38.3% 生产文件，
    // 门槛"形式上生效、实质上不覆盖新增面"）
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      // 口径扩到全仓 .ts（main/services+templates+ipc、shared、renderer、preload），
      // 阈值按目录 glob 分层（与 vitest thresholds glob 语义一致）；
      // .vue 文件不纳入（v8 provider 对 vue sourcemap 行映射不可靠，纳入会产生噪声阈值）
      include: [
        'src/main/**/*.ts',
        'src/shared/**/*.ts',
        'src/renderer/src/**/*.ts',
        'src/preload/**/*.ts'
      ],
      exclude: ['**/*.spec.ts', '**/__tests__/**'],
      // 阈值按全量实测校准（实测：services 74/76/77/74、templates 98/97/90/98、
      // ipc 45/53/87/45、shared 92/96/79/92、renderer 26/50/79/26、preload 97/98/100/97），
      // 各目录向下留 2-10 个百分点余量防波动
      thresholds: {
        'src/main/services/**': { lines: 72, functions: 72, branches: 72, statements: 72 },
        'src/main/templates/**': { lines: 96, functions: 90, branches: 86, statements: 96 },
        'src/main/ipc/**': { lines: 40, functions: 45, branches: 55, statements: 40 },
        'src/shared/**': { lines: 88, functions: 90, branches: 72, statements: 88 },
        'src/renderer/**': { lines: 24, functions: 45, branches: 60, statements: 24 },
        'src/preload/**': { lines: 92, functions: 90, branches: 80, statements: 92 }
      }
    }
  }
})
