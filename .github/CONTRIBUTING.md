# 贡献指南

感谢愿意花时间看这个项目。这是一个个人维护的桌面应用（Electron + Vue 3 + TypeScript），
下面是让改动顺利合入所需的最少信息。

## 环境准备

- **Node.js ≥ 22**（开发与构建本应用用）
- 模组项目的 JDK 与 Minecraft 运行时**不需要预装**，应用内「设置 → 运行环境」按需自动下载
- 只有跑「矩阵门禁」（真实 `gradlew build` 模板组合）才需要本机有 JDK 17 / 21 / 25

```bash
npm ci
npm run dev        # 开发模式（界面中文）
```

`npm run dev` 内含针对企业 EDR / 安全软件的规避 shim，若启动失败请先看
[README「已知环境问题」](../README.md#已知环境问题) 与 `scripts/run-electron-vite.cjs` 头部注释。

## 提交前必须本地跑通

| 命令 | 作用 |
| --- | --- |
| `npm run typecheck` | 双端类型检查（node + web），必须零错误 |
| `npm run lint` | ESLint `--max-warnings 0`，零告警 |
| `npm run test` | 全量单测（vitest） |

这三条与 CI 门禁一致，本地绿了 CI 基本就绿。CI 会在 **Windows / Ubuntu / macOS**
三平台各跑一遍门禁，所以请避免写死平台路径、盘符或 `.exe` 名（见下方「平台注意」）。

涉及模板/加载器改动时另跑 `npm run test:matrix-pr`（PR 档轻量矩阵）。

## 提交信息与 PR

- 提交信息用**中文 conventional commits**：`fix(scope): 说明` / `feat(scope): 说明` /
  `chore:` / `docs:` / `test:`。说明写清「为什么」，而不是复述改了哪几行。
- 一个 PR 聚焦一件事。大改动（新增子系统、改数据结构、动打包链路）建议先开 issue
  说清方案再动手，避免白写。
- PR 描述里写清：改了什么、怎么验证的（跑了哪些命令 / 手工验了哪条路径）。
- 不要提交 `out/`、`dist/`、`resources/models/` 等构建与二进制产物；不要提交任何密钥、
  token、`.env`。

## 平台注意（跨平台适配的坑）

应用同时面向 Windows / macOS / Linux，改动时留意：

- **不要写死路径**：用 `node:path` 拼接；Windows 专属可执行名（`javaw.exe`、
  `explorer.exe`）必须先判断 `process.platform`。macOS 上 `/var` 是 `/private/var`
  的符号链接——比较路径时考虑 `realpath`。
- **主进程是 ESM，但依赖多为 CJS**：主进程产物为 ESM（`package.json` 的
  `type: module`）。对 CJS 依赖使用**具名导入**会依赖 Node 的静态分析
  （`cjs-module-lexer`），像 `Object.defineProperty(exports, ...)` 这类惰性 getter
  检测不到，会在**模块链接阶段**直接抛
  `SyntaxError: Named export 'x' not found` —— 表现是「应用完全起不来」，而
  typecheck 与单测（走 vite/esbuild 转换）都不会报错。稳妥做法是 default 导入：

  ```ts
  import pkg from 'some-cjs-dep'
  const { thing } = pkg
  ```

  新增生产依赖后，建议本地 `npm run build` 后确认 `out/main/index.js` 能正常加载。
- 改 `.github/workflows/*.yml` 时**必须保持 LF 换行**：Windows CRLF 会导致 YAML 解析失败。

## 代码与文档约定

- 目录职责、IPC、数据流、安全模型见 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)；
  脚本与测试策略、代码约定见 [docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md)。
- 注释写「为什么」（尤其是反直觉的绕行与踩坑），不写「这行做了什么」。
- 改动 `resources/knowledge` 语料后执行 `npm run kb:manifest` 刷新版本指纹。

## 报告问题

功能缺陷 / 使用问题走 issue，附上版本号（设置页或安装包名）、平台与复现步骤；
安全漏洞**不要**开公开 issue，按 [SECURITY.md](SECURITY.md) 私密报告。
