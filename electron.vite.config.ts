import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

const rootDir = resolve(__dirname)
const rendererSrc = resolve(rootDir, 'src/renderer/src')
const sharedDir = resolve(rootDir, 'src/shared')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(rootDir, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(rootDir, 'src/preload/index.ts')
        },
        // sandbox:true 要求 preload 为 CommonJS（沙箱渲染器不支持 ESM preload）
        output: {
          format: 'cjs',
          entryFileNames: '[name].js'
        }
      }
    }
  },
  renderer: {
    root: resolve(rootDir, 'src/renderer'),
    resolve: {
      alias: {
        '@renderer': rendererSrc,
        '@shared': sharedDir
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(rootDir, 'src/renderer/index.html')
        }
      }
    },
    plugins: [
      vue({
        template: {
          // Electron <webview> 是内置自定义元素，不能交给 Vue 组件解析
          compilerOptions: {
            isCustomElement: (tag: string) => tag === 'webview'
          }
        }
      })
    ]
  }
})
