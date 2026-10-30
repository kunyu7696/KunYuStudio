import type { Component } from 'vue'
import type { ProjectType } from '../../../shared/types/project'

/**
 * 活动栏模块统一接口（设计文档 9.2.3）
 * 新模块只需实现该接口并调用 moduleRegistry.register()，无需修改主框架代码。
 */
export interface KunYuModule {
  /** 唯一标识，同时作为持久化键 */
  id: string
  /** 侧边栏 / 提示中展示的名称 */
  name: string
  /** 活动栏图标（@element-plus/icons-vue 组件） */
  icon: Component
  /** 模块说明（占位页与后续详情面板使用） */
  description: string
  /**
   * 懒加载器：() => import('./views/XxxView.vue')，
   * 由 Vite 自动拆包，首次激活时才加载。
   */
  loader?: () => Promise<{ default: Component }>
  /** 已就绪组件（与 loader 二选一，用于不需要拆包的轻量页面） */
  component?: Component
  /**
   * 侧边栏懒加载器：提供模块专属侧边栏内容（如资源管理器的文件树）。
   * 未提供时 SideBar 渲染通用占位。
   */
  sidebarLoader?: () => Promise<{ default: Component }>
  /** 活动栏位置：常规模块在顶部，设置等固定在底部 */
  placement?: 'top' | 'bottom'
  /**
   * 仅在指定项目类型下可见（如三个包编辑器）。
   * 缺省表示对所有项目类型可见。
   */
  projectTypes?: ProjectType[]
  /** 为 true 时仅在已打开项目后可见（无项目时隐藏） */
  requireProject?: boolean
  /**
   * 为 true 时仅在「未打开项目」时可见（主页活动栏专用入口，打开项目后隐藏）。
   * 与 requireProject 语义相反：requireProject 是「只在项目里」，homeOnly 是「只在主页」。
   */
  homeOnly?: boolean
  /** 激活回调，模块在此申请资源（订阅事件、启动定时器等） */
  onActivate?: () => void
  /** 停用回调，模块在此释放资源 */
  onDeactivate?: () => void
}

class ModuleRegistry {
  private modules = new Map<string, KunYuModule>()

  register(mod: KunYuModule): void {
    if (this.modules.has(mod.id)) {
      throw new Error(`模块已存在，重复注册: ${mod.id}`)
    }
    this.modules.set(mod.id, mod)
  }

  unregister(id: string): void {
    this.modules.delete(id)
  }

  get(id: string): KunYuModule | undefined {
    return this.modules.get(id)
  }

  has(id: string): boolean {
    return this.modules.has(id)
  }

  list(placement?: KunYuModule['placement']): KunYuModule[] {
    const all = [...this.modules.values()]
    if (!placement) return all
    return all.filter((m) => (m.placement ?? 'top') === placement)
  }
}

export const moduleRegistry = new ModuleRegistry()
