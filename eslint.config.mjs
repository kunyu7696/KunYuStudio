// ESLint 配置（阶段2：typed 规则上线）。
// 历史：P2-J 仅开 no-use-before-define（TDZ 黑屏事故教训）；
// 阶段1 接入 @typescript-eslint/recommended（error 级），73 条存量清零；
// 阶段2 接入 typed lint（projectService）：no-floating-promises / no-explicit-any
// 存量 13 条清零后转 error。
// 约定：
// - no-unused-vars 放行 `_` 前缀（有意未使用的参数/变量/catch 绑定，标准约定）
// - no-floating-promises 仅 .ts 块开启（typed 规则需类型信息；
//   .vue SFC 的 typed lint 支持不成熟，脚本块暂不覆盖）
// - 测试文件放宽：no-use-before-define 豁免（describe 回调引用外层 let 是常见模式）、
//   no-explicit-any 关闭（夹具/mock 构造宽松，readJsonRel 返回 JSON.parse 结果等）
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import vueParser from 'vue-eslint-parser'
import noHardcodedZh from './eslint/rules/no-hardcoded-zh.mjs'
import zhBaseline from './eslint/zh-baseline.mjs'

const kunyuPlugin = { rules: { 'no-hardcoded-zh': noHardcodedZh } }

const rules = {
  // recommended 规则集整体接入（error 级）
  ...tsPlugin.configs.recommended.rules,
  // `_` 前缀视为有意未使用
  '@typescript-eslint/no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
      destructuredArrayIgnorePattern: '^_'
    }
  ],
  // 阶段2：存量清零后转 error（测试文件在下方豁免块放宽）
  '@typescript-eslint/no-explicit-any': 'error',
  // TS 感知版：正确处理类型导入、函数提升、类声明合并等场景
  '@typescript-eslint/no-use-before-define': [
    'error',
    {
      functions: false, // 函数声明提升合法
      classes: true, // 类必须先声明后使用
      variables: true, // 变量必须先声明后使用（let/const TDZ）
      allowNamedExports: false
    }
  ]
}

export default [
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', 'resources/**', '**/*.d.ts']
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        // typed lint：按文件就近匹配 tsconfig（tsconfig.node.json / tsconfig.web.json）
        projectService: true
      }
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...rules,
      // 未处理的 Promise 必须 await / void / .catch（阶段2 typed 规则）
      '@typescript-eslint/no-floating-promises': 'error'
    }
  },
  {
    files: ['src/**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        // SFC 的 <script> 块由 TS parser 接管；模板部分仅做语法解析
        parser: tsParser,
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules
  },
  {
    // 测试文件放宽：no-use-before-define（describe 回调引用外层 let）、
    // no-explicit-any（夹具/mock 构造宽松）
    files: ['**/*.spec.ts', '**/*.test.ts', '**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-use-before-define': 'off',
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },
  {
    // 阶段3：渲染层禁止新增硬编码中文（script 字面量/模板字符串 + .vue 模板文本/静态属性）
    files: ['src/renderer/src/**/*.ts', 'src/renderer/src/**/*.vue'],
    plugins: { kunyu: kunyuPlugin },
    rules: { 'kunyu/no-hardcoded-zh': 'error' }
  },
  {
    // 豁免：存量基线（国际化后从中移除）+ i18n 翻译源 + 渲染层测试
    files: [...zhBaseline, 'src/renderer/src/i18n/**/*', 'src/renderer/src/**/*.spec.ts'],
    rules: { 'kunyu/no-hardcoded-zh': 'off' }
  }
]
