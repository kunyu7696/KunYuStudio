/**
 * Playbook：加载器平台（Fabric/Forge/NeoForge 元数据、上游版本对齐、Mixin 四步）。
 * 对应 KunYu 纪律：三加载器映射禁止混用；API 不确定显式声明；Mixin 走
 * target_lookup → scaffold → register → validate 固定链路。
 */
import type { Playbook } from './types'

export const loaderPlatformPlaybook: Playbook = {
  id: 'loader-platform',
  title: '加载器平台规程',
  triggers: ['mixin', '混入', 'fabric.mod.json', 'mods.toml', '注册骨架', '入口类', 'entrypoint', '注入'],
  contentTypes: ['mixin', 'project'],
  route: {
    tools: [
      'fabric_meta_version_check',
      'forge_meta_version_check',
      'neoforge_meta_version_check',
      'fabric_javadoc_lookup',
      'fabric_template_generate',
      'fabric_content_register',
      'fabric_data_assets_generate',
      'fabric_mod_json_validate',
      'forge_mods_toml_validate',
      'neoforge_mods_toml_validate',
      'mixin_target_lookup',
      'mixin_scaffold',
      'mixin_register',
      'mixin_validate'
    ],
    note:
      '动手前先对应 loader 的 meta_version_check 对齐上游版本；Yarn 成员速查 fabric_javadoc_lookup；' +
      'Mixin 固定四步 target_lookup→scaffold→register→validate；元数据文件保存前用对应 validate。'
  },
  workflow: [
    'meta_version_check 对齐上游版本',
    '按当前项目 loader 的映射生成/校验（禁止混用 Yarn 与 Mojmap）',
    'fabric.mod.json / mods.toml 保存前 validate',
    '涉及 Mixin 走四步链（lookup→scaffold→register→validate）'
  ],
  acceptanceGates: [
    'fabric.mod.json / mods.toml validate 通过',
    'Mixin 已 validate 且登记进 mixin 配置（漏注册 = 运行期不生效）'
  ],
  failureContract: [
    '映射或 API 不确定时显式声明不确定，禁止编造类名/方法名',
    '跨 loader 写法差异按当前项目 loader 输出，不混用映射标识符'
  ]
}
