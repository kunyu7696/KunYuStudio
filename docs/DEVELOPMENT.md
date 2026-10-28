# KunYu 开发指南

> 面向贡献者的工程约定：环境、脚本、测试、代码与文档纪律。
> 架构见 [ARCHITECTURE.md](ARCHITECTURE.md)。

---

## 一、环境要求

- Node.js ≥ 22（开发本应用）；
- Windows 优先（PowerShell 5）；模组项目所需 JDK 与 Minecraft 运行时由应用
  内置引导器自动准备，无需预装；
- 部分企业 EDR 会拦截 `node_modules` 内进程——`npm run dev` 已内置规避
  （见 README「已知环境问题」）。

## 二、脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发模式（`--noSandbox`，含 EDR 规避 shim） |
| `npm run build` | 编译 out/ 产物 |
| `npm run preview` | 预览构建产物 |
| `npm run build:win` | Windows NSIS 安装包（ACL 修复 → observer agent 构建 → 编译 → 产物新鲜度断言 → electron-builder → 分发新鲜度校验） |
| `npm run typecheck` | 双端类型检查（`typecheck:node` + `typecheck:web`） |
| `npm run test` | 全量单测（vitest） |
| `npm run test:watch` | watch 模式 |
| `npm run test:coverage` | 覆盖率 |
| `npm run test:matrix` / `test:matrix-pr` | 加载器 × MC 版本模板矩阵门禁 |
| `npm run lint` | ESLint（`--max-warnings 0`） |
| `npm run fetch-models` | 预拉 bge-small-zh 离线嵌入模型（打包用） |
| `npm run verify:enchant` | 附魔构建产物校验 |

单个 spec 文件调试：

```powershell
node scripts/run-vitest.cjs run src/shared/modeler/__tests__/mesh.spec.ts
```

`build:win` 前置：

1. `resources/observer-mod` 下执行一次 `gradlew build`（JDK 17）；
2. `npm run fetch-models`（可选，缺失时运行时回退在线下载）。

## 三、测试策略

- **分层环境**：`src/main` / `src/shared` 跑 node 环境，`src/renderer` 跑
  jsdom 环境；
- **规模**：276 个测试文件；AI 服务、建模器核心（`shared/modeler`）、schema
  适配器、主进程服务覆盖较密；
- **风格**：主进程服务以纯函数 + 模拟上下文单测为主；渲染层对 composable 与
  store 做行为测试；属性测试用 fast-check；
- **门禁**：PR 需过 双端 typecheck + lint 零告警 + 全量单测；矩阵门禁按
  加载器 × 版本组合验证模板可生成；
- **产物新鲜度**：构建后断言产物为本次生成，杜绝陈旧包。

## 四、代码约定

- 语言：TypeScript 严格模式；注释、提交信息、文档全中文；
- 渲染层不直接触达网络 / 文件系统 / 子进程，一律经主进程服务；
- 共享层（`src/shared`）只放纯数据与纯函数，禁止依赖 DOM / three / Electron；
- IPC：通道常量集中在 `src/shared/types/ipc.ts`，失败以
  `{ ok:false, errorKind, errorMessage }` 包装返回，不依赖异常序列化；
- AI 工具：软失败（`ok:false` + 文本说明），不阻断流水线；新工具按域放进
  `src/main/services/ai/fcTools/`；
- Windows 命令行：PowerShell 5 无 `&&`，串联用 `;`；
- 提交前至少通过 `typecheck` + `test` + `lint`；
- 修改产物生成相关代码后跑一次 `build` 验证产物新鲜度断言。

## 五、文档纪律

- 文档不写日期与工程日期（LICENSE 生效日、CHANGELOG、第三方许可、数据文件
  版本日期除外）；
- 署名统一「kunyu (睏欤)」，不用真实姓名；
- 涉及开源社区（Fabric / Forge / NeoForge / Blockbench / minecraft-data 等）
  的表述保持谦逊、充分致谢；KunYuStudio 大量受益于这些社区的开放成果；
- 建模器相关实现遵循 clean-room：不读不抄 Blockbench 源码，只依据官方 wiki
  与公开格式规范独立实现；
- 文档以代码实测为准：数字（通道数、工具数、模板数）改动后同步更新文档。

## 六、目录速查

新增一个领域能力的最短路径见 [ARCHITECTURE.md](ARCHITECTURE.md) 第十一节
（扩展指南）。

---

*—— kunyu (睏欤)*
