/**
 * 特性⑤ CI 工作流 YAML 生成器（纯函数，不写盘）。
 *
 * 生成三种 GitHub Actions 工作流：
 * - build.yml：三加载器矩阵编译 + jar artifact 上传
 * - release.yml：tag 触发 + workflow_dispatch 手动确认发布（AI 不替用户做决定）
 * - gametest.yml：复用特性④ githubActionsWorkflow()
 *
 * YAML 用 \n 换行（CI runner 在 Linux，避免 CRLF）；
 * 字符串拼接而非模板引擎，保持与现有 fabricTemplates 一致风格。
 */
import { githubActionsWorkflow } from '../../templates/fabricTemplates'
import { getToolchain, isSupportedCombo } from '../../templates/loaderVersionMatrix'
import type { CiConfig, CiWorkflowKind } from '../../../shared/types/ci'
import type { ModLoader } from '../../../shared/types/project'
import type { CiProjectMeta } from './buildGradleForLoader'

/** 工作流预览结果 */
export type WorkflowPreview = Partial<Record<CiWorkflowKind, string>>

/**
 * 生成 build.yml：三加载器矩阵编译 + artifact 上传。
 *
 * 矩阵中每个 loader job：
 * 1. checkout → setup 该 loader 在项目 MC 版本下所需的 JDK → cache Gradle
 * 2. cp .kunyu/ci/build-<loader>.gradle build.gradle + gradle-<loader>.properties gradle.properties
 * 3. ./gradlew build --console=plain
 * 4. upload-artifact build/libs/*.jar
 *
 * JDK 随矩阵走（版本矩阵真源）：fabric/forge 1.20.x=17、1.21 线=21；
 * neoforge 1.20.4=17、1.20.6+=21。固定 17 会让 21 的组合在 CI 直接失败。
 */
export function generateBuildWorkflow(config: CiConfig, meta: CiProjectMeta): string {
  const loaders: ModLoader[] = config.matrix.loaders.length > 0 ? config.matrix.loaders : ['fabric']
  // matrix.include 为每个 loader 附带 jdk 维度
  const includeRows = loaders
    .map((l) => `          - loader: '${l}'\n            jdk: ${getToolchain(l, meta.mcVersion).jdk}`)
    .join('\n')

  return [
    'name: Build',
    '',
    'on:',
    '  push:',
    '    branches: [main, master]',
    '  pull_request:',
    '    branches: [main, master]',
    '',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    strategy:',
    '      fail-fast: false',
    '      matrix:',
    '        include:',
    includeRows,
    '',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '',
    '      - name: Setup JDK ${{ matrix.jdk }}',
    '        uses: actions/setup-java@v4',
    '        with:',
    '          distribution: temurin',
    '          java-version: "${{ matrix.jdk }}"',
    '',
    '      - name: Cache Gradle',
    '        uses: actions/cache@v4',
    '        with:',
    '          path: |',
    '            ~/.gradle/caches',
    '            ~/.gradle/wrapper',
    '          key: ${{ runner.os }}-gradle-${{ matrix.loader }}-${{ hashFiles(\'**/*.gradle*\', \'gradle.properties\') }}',
    '          restore-keys: ${{ runner.os }}-gradle-${{ matrix.loader }}-',
    '',
    '      - name: Select build.gradle for ${{ matrix.loader }}',
    '        run: |',
    '          cp .kunyu/ci/build-${{ matrix.loader }}.gradle build.gradle',
    '          cp .kunyu/ci/gradle-${{ matrix.loader }}.properties gradle.properties',
    '',
    '      - name: Build mod jar',
    '        run: ./gradlew build --console=plain --stacktrace',
    '',
    '      - name: Upload mod artifact',
    '        uses: actions/upload-artifact@v4',
    '        with:',
    '          name: mod-${{ matrix.loader }}',
    '          path: build/libs/*.jar',
    ''
  ].join('\n')
}

/**
 * 生成 release.yml：tag 触发 + 手动确认发布。
 *
 * 设计要点（用户要求「AI agent 不替用户做发布决定」）：
 * 1. workflow_dispatch 带 inputs：publish_github / publish_modrinth / publish_curseforge
 *    用户在 GitHub Actions UI 手动触发并勾选发布平台
 * 2. environment: release —— GitHub 仓库设置中配 required reviewers，
 *    tag push 触发后需人工审批才继续
 * 3. 各发布步骤 if: ${{ inputs.publish_* }} 条件控制
 * 4. API token 通过 GitHub Secrets 注入（不在配置里存实际密钥）
 */
/** 矩阵 loaders 在项目 MC 版本下所需 JDK 的最大大版本（17 兜底） */
function matrixJdk(config: CiConfig, mcVersion: string): number {
  return Math.max(17, ...config.matrix.loaders.map((l) => getToolchain(l, mcVersion).jdk))
}

export function generateReleaseWorkflow(config: CiConfig, meta?: CiProjectMeta): string {
  const s = config.secrets
  // release 只构建一次（项目自身 build.gradle）；JDK 取矩阵在项目 MC 版本下的最大值
  // （21 可向下兼容跑 17 的 Gradle 构建）；无 meta 时回退 17。
  const jdk = meta ? matrixJdk(config, meta.mcVersion) : 17
  const lines: string[] = [
    'name: Release',
    '',
    'on:',
    '  push:',
    '    tags:',
    '      - \'v*\'',
    '  workflow_dispatch:',
    '    inputs:',
    '      tag_name:',
    '        description: \'Release tag (e.g. v1.0.0)\'',
    '        required: true',
    '        type: string',
    '      publish_github:',
    '        description: \'Publish to GitHub Release\'',
    '        type: boolean',
    '        default: true',
    '      publish_modrinth:',
    '        description: \'Publish to Modrinth\'',
    '        type: boolean',
    '        default: false',
    '      publish_curseforge:',
    '        description: \'Publish to CurseForge\'',
    '        type: boolean',
    '        default: false',
    '',
    'jobs:',
    '  release:',
    '    runs-on: ubuntu-latest',
    '    environment: release',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '',
    `      - name: Setup JDK ${jdk}`,
    '        uses: actions/setup-java@v4',
    '        with:',
    '          distribution: temurin',
    `          java-version: "${jdk}"`,
    '',
    '      - name: Cache Gradle',
    '        uses: actions/cache@v4',
    '        with:',
    '          path: |',
    '            ~/.gradle/caches',
    '            ~/.gradle/wrapper',
    '          key: ${{ runner.os }}-gradle-${{ hashFiles(\'**/*.gradle*\', \'gradle.properties\') }}',
    '          restore-keys: ${{ runner.os }}-gradle-',
    '',
    '      - name: Build mod jar',
    '        run: ./gradlew build --console=plain --stacktrace',
    ''
  ]

  if (config.publish.githubRelease) {
    lines.push(
      '      - name: Create GitHub Release',
      '        if: ${{ inputs.publish_github }}',
      '        uses: softprops/action-gh-release@v2',
      '        with:',
      '          tag_name: ${{ inputs.tag_name || github.ref_name }}',
      '          files: build/libs/*.jar',
      '          generate_release_notes: true',
      ''
    )
  }

  if (config.publish.modrinth) {
    lines.push(
      '      - name: Publish to Modrinth',
      '        if: ${{ inputs.publish_modrinth }}',
      '        uses: Kir-Antipov/mc-publish@v3.3.0',
      '        with:',
      `          modrinth-id: \${{ secrets.${s.modrinth.replace(/[^A-Z_]/gi, '_').toUpperCase()}_ID }}`,
      `          modrinth-token: \${{ secrets.${s.modrinth.replace(/[^A-Z_]/gi, '_').toUpperCase()} }}`,
      '          files: build/libs/*.jar',
      '          name: ${{ inputs.tag_name || github.ref_name }}',
      ''
    )
  }

  if (config.publish.curseforge) {
    lines.push(
      '      - name: Publish to CurseForge',
      '        if: ${{ inputs.publish_curseforge }}',
      '        uses: Kir-Antipov/mc-publish@v3.3.0',
      '        with:',
      `          curseforge-id: \${{ secrets.${s.curseforge.replace(/[^A-Z_]/gi, '_').toUpperCase()}_ID }}`,
      `          curseforge-token: \${{ secrets.${s.curseforge.replace(/[^A-Z_]/gi, '_').toUpperCase()} }}`,
      '          files: build/libs/*.jar',
      ''
    )
  }

  return lines.join('\n')
}

/**
 * 生成 gametest.yml：复用特性④ githubActionsWorkflow()。
 * 保持与特性④完全一致的行为。
 */
export function generateGametestWorkflow(meta?: CiProjectMeta): string {
  // JDK 随矩阵走：项目自身 loader 未知时，取三加载器在该 MC 版本下所需最大值；
  // 无 meta（单测直调）时回退 17。
  const jdk = meta
    ? Math.max(
        17,
        ...(['fabric', 'forge', 'neoforge'] as ModLoader[])
          // 只取矩阵中实际登记的组合：未登记 loader 会回退到其默认 MC（可能跨大版本）污染结果
          .filter((l) => isSupportedCombo(l, meta.mcVersion))
          .map((l) => getToolchain(l, meta.mcVersion).jdk)
      )
    : 17
  return githubActionsWorkflow(jdk)
}

/**
 * 预览所有已开启的工作流 YAML（不写盘）。
 * 返回 { build?, release?, gametest? }，未开启的 kind 不含 key。
 */
export function previewWorkflows(config: CiConfig, meta: CiProjectMeta): WorkflowPreview {
  const result: WorkflowPreview = {}
  if (config.workflows.build) {
    result.build = generateBuildWorkflow(config, meta)
  }
  if (config.workflows.release) {
    result.release = generateReleaseWorkflow(config, meta)
  }
  if (config.workflows.gametest) {
    result.gametest = generateGametestWorkflow(meta)
  }
  return result
}

export { githubActionsWorkflow }
