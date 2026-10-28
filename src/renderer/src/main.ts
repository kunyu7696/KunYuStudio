import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'
import { registerBuiltinModules } from './modules'
import { applyInitialThemeFromCache } from './utils/theme'
import './styles/theme.css'

// 先注册活动栏模块，再挂载应用，保证初始模块可被解析
registerBuiltinModules()

// 开发环境清理历史残留的活动模块持久化（沙箱环境下 AppData 旧配置可能干扰）
if (import.meta.env.DEV) {
  localStorage.removeItem('kunyu:active-module')
}

// 启用主题（必须在 mount 前加 class，否则 Element css-vars 不命中）：
// 先按 localStorage 缓存的解析结果设置 class 避免首帧闪烁；
// App.vue 在 settings.hydrate() 后按设置的 themeMode 校正
applyInitialThemeFromCache()

createApp(App).use(createPinia()).use(ElementPlus, { locale: zhCn }).mount('#app')
