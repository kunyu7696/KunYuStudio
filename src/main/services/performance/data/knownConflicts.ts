/**
 * 已知硬冲突库：两个模组无法共存（崩溃/渲染器互斥/核心引擎替换）。
 * 条目须为社区广泛确认的互斥关系，宁可少列避免误报。
 */
export interface KnownConflict {
  modA: string
  modB: string
  reason: string
}

export const KNOWN_CONFLICTS: KnownConflict[] = [
  {
    modA: 'optifine',
    modB: 'sodium',
    reason: '二者为互斥的渲染引擎（OptiFine 基于 OpenGL 管线，Sodium 重写渲染管线），同时加载会渲染异常或崩溃'
  },
  {
    modA: 'optifine',
    modB: 'iris',
    reason: 'Iris 基于 Sodium 的渲染管线加载光影，与 OptiFine 的光影/渲染实现互斥'
  },
  {
    modA: 'optifine',
    modB: 'oculus',
    reason: 'Oculus 是 Iris 的 Forge 移植，与 OptiFine 的渲染管线互斥'
  },
  {
    modA: 'optifine',
    modB: 'rubidium',
    reason: 'Rubidium 是 Sodium 的 Forge 移植，与 OptiFine 渲染管线互斥'
  },
  {
    modA: 'phosphor',
    modB: 'starlight',
    reason: '二者重写同一光照引擎，Starlight 完全取代 Phosphor 的光照修复，同时加载会冲突'
  },
  {
    modA: 'vulkanmod',
    modB: 'sodium',
    reason: 'VulkanMod 以 Vulkan 替换整个 OpenGL 渲染后端，与 Sodium 的 GL 渲染重写互斥'
  },
  {
    modA: 'vulkanmod',
    modB: 'iris',
    reason: 'Iris 光影基于 OpenGL/Sodium 管线，与 VulkanMod 的 Vulkan 后端不兼容'
  },
  {
    modA: 'rubidium',
    modB: 'embeddium',
    reason: '二者是同一 Sodium Forge 移植的不同分支（Rubidium 停更后由 Embeddium 接替），同时加载类冲突'
  },
  {
    modA: 'sodium',
    modB: 'canvas',
    reason: 'Canvas 提供独立渲染管线，与 Sodium 的渲染重写互斥'
  }
]
