/**
 * MCP 工具权限分组映射（TR #4「MCP 分组授权」）。
 * 复用 McpPermission 体系，把 KunYu 作为 MCP server 暴露的工具名映射到
 * read / interact / admin 三组，供授权门与审计日志使用。
 */
import type { McpPermission } from './types/settings'

/** 现有只读白名单：检索查询类，不弹授权窗 */
const READONLY_TOOLS: ReadonlySet<string> = new Set([
  'template_search',
  'kb_search',
  'mc_data_lookup',
  'error_analyze',
  'version_check',
  'api_validate',
  'project_grep',
  'mc_state',
  'mc_screenshot',
  'mc_world',
  'mc_observe_entity',
  'mc_inventory',
  'content_list',
  'content_read',
  'model_validate',
  'item_validate',
  'fabric_mod_json_validate',
  'fabric_log_debugger',
  'fabric_meta_version_check',
  'fabric_javadoc_lookup',
  'forge_mods_toml_validate',
  'neoforge_mods_toml_validate',
  'forge_meta_version_check',
  'neoforge_meta_version_check',
  'recipe_validate',
  'mixin_target_lookup',
  'mixin_validate',
  'market_search_mods',
  'market_mod_detail',
  'market_list_installed'
])

/** 内容写入类（interact）：写文件/贴图/配方/注册骨架等 */
const INTERACT_TOOLS: ReadonlySet<string> = new Set([
  'content_upsert',
  'write_project_file',
  'texture_paint',
  'texture_pixelize',
  'texture_repaint',
  'recipe_create',
  'recipe_generate',
  'fabric_template_generate',
  'fabric_content_register',
  'fabric_data_assets_generate',
  'mixin_scaffold',
  'mixin_register'
])

/**
 * 把单个工具名映射到权限分组。
 * - read：只读检索（现有 READONLY_TOOLS + mcdev_ 前缀）
 * - interact：内容写入（写文件/贴图/配方/骨架等）
 * - admin：命令执行/安装/游戏控制/未知工具（默认最严格）
 */
export function getMcpToolPermission(tool: string): McpPermission {
  if (READONLY_TOOLS.has(tool)) return 'read'
  if (tool.startsWith('mcdev_')) return 'read'
  if (INTERACT_TOOLS.has(tool)) return 'interact'
  return 'admin'
}
