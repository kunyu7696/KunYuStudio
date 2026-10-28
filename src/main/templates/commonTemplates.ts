/**
 * 三加载器项目根级模板文件（.gitignore / .gitattributes / README 等）。
 * 内容逐一对齐官方模板仓库原文：
 * - Fabric   : fabricmc/fabric-example-mod
 * - Forge    : MinecraftForge/MinecraftForge mdk/（1.20.x，gitignore.txt/gitattributes.txt/forge_README.txt）
 * - NeoForge : neoforged/MDK（archive/1.21.4-mdg）
 * 保证新建项目与社区下载的模板工程文件树一致，直接导入 IDE / Git 即可使用。
 */

/** 加载器键（与 shared/types/project.ts 的 ModLoader 对齐） */
export type ModLoaderKey = 'fabric' | 'forge' | 'neoforge'

/** Fabric 官方示例工程 .gitignore（fabric-example-mod 原文） */
const GITIGNORE_FABRIC = `# gradle
.gradle/
build/
out/
classes/

# eclipse
*.launch

# idea
.idea/
*.iml
*.ipr
*.iws

# vscode
.settings/
.vscode/
bin/
.classpath
.project

# macos
*.DS_Store

# fabric
run/
`

/** Forge 官方 MDK .gitignore（mdk/gitignore.txt 原文） */
const GITIGNORE_FORGE = `# eclipse
bin
*.launch
.settings
.metadata
.classpath
.project

# idea
out
*.ipr
*.iws
*.iml
.idea

# gradle
build
.gradle

# other
eclipse
run

# Files from Forge MDK
forge_README.txt
forge*changelog.txt
`

/** NeoForge 官方 MDK .gitignore（neoforged/MDK 原文） */
const GITIGNORE_NEOFORGE = `# eclipse
bin
*.launch
.settings
.metadata
.classpath
.project

# idea
out
*.ipr
*.iws
*.iml
.idea

# gradle
build
.gradle

# other
eclipse
run
runs
run-data

repo
`

/** Fabric 官方示例工程 .gitattributes（fabric-example-mod 原文） */
const GITATTRIBUTES_FABRIC = `# Automatically normalize line endings for all text-based files
# http://git-scm.com/docs/gitattributes#_text
* text=auto eol=lf

# Declare files that will always have CRLF line endings on checkout.
*.bat text eol=crlf

# Denote all files that are truly binary and should not be modified.
*.jar binary
`

/**
 * Forge / NeoForge 官方 .gitattributes（两仓 gitattributes.txt 内容一致，
 * 只约束 src/generated 产物固定 LF，不做全局归一化）
 */
const GITATTRIBUTES_FML = `# Disable autocrlf on generated files, they always generate with LF
# Add any extra files or paths here to make git stop saying they
# are changed when only line endings change.
src/generated/**/.cache/cache text eol=lf
src/generated/**/*.json text eol=lf
`

/** Forge 官方 MDK forge_README.txt（mdk/forge_README.txt 原文，安装与 IDE 导入指引） */
export const FORGE_README_TXT = `Source installation information for modders
-------------------------------------------
This code follows the Minecraft Forge installation methodology. It will apply
some small patches to the vanilla MCP source code, giving you and it access
to some of the data and functions you need to build a successful mod.

Please note that this example MDK is a simple showcase for the most basic of mods.
To see more examples see our dedicated examples repository under the "Additional Resources" section.

Setup Process:
==============================

Step 1: Open your command-line and browse to the folder where you extracted the zip file.

Step 2: You're left with a choice.
If you prefer to use Eclipse:
1. Run the following command: \`./gradlew genEclipseRuns\`
2. Open Eclipse, Import > Existing Gradle Project > Select Folder
   or run \`gradlew eclipse\` to generate the project.

If you prefer to use IntelliJ:
1. Open IDEA, and import project.
2. Select your build.gradle file and have it import.
3. Use the run tasks located under the "Slime Launcher" Gradle task group.

If at any point you are missing libraries in your IDE, or you've run into problems you can
run \`gradlew --refresh-dependencies\` to refresh the local cache. \`gradlew clean\` to reset everything
(this does not affect your code) and then start the process again.

Additional Resources:
==========================
Community Documentation: https://docs.minecraftforge.net/en/latest/gettingstarted/
Additional Examples: https://github.com/MinecraftForge/MDKExamples
LexManos' Install Video: https://youtu.be/8VEdtQLuLO0
Forge Forums: https://forums.minecraftforge.net/
Forge Discord: https://discord.minecraftforge.net/
`

/** 按加载器取官方 .gitignore */
export function gitignoreFor(loader: ModLoaderKey): string {
  if (loader === 'fabric') return GITIGNORE_FABRIC
  if (loader === 'forge') return GITIGNORE_FORGE
  return GITIGNORE_NEOFORGE
}

/** 按加载器取官方 .gitattributes（Forge/NeoForge 同内容） */
export function gitattributesFor(loader: ModLoaderKey): string {
  return loader === 'fabric' ? GITATTRIBUTES_FABRIC : GITATTRIBUTES_FML
}

const LOADER_DISPLAY: Record<ModLoaderKey, string> = {
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge'
}

/** README.md：项目说明骨架（mod 名/加载器/MC 版本 + 构建运行指引） */
export function readmeMd(v: { modName: string; loader: ModLoaderKey; mcVersion: string }): string {
  const loader = LOADER_DISPLAY[v.loader]
  return `# ${v.modName}

基于 ${loader} / Minecraft ${v.mcVersion} 的模组工程（KunYu Studio 生成）。

## 构建

\`\`\`sh
./gradlew build
\`\`\`

产物输出到 \`build/libs/\`。

## 本地运行

\`\`\`sh
./gradlew runClient
\`\`\`
`
}
