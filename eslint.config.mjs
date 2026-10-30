// ESLint 配置（阶段1：接入 @typescript-eslint/recommended，error 级）。
// 历史：P2-J 仅开 no-use-before-define（TDZ 黑屏事故教训）；
// 阶段1 审计存量 73 条后清零修复，直接转 error 防新增。
// 约定：
// - no-unused-vars 放行 `_` 前缀（有意未使用的参数/变量/catch 绑定，标准约定）
// - no-explicit-any 显式关闭——阶段2 统计存量后再定 warn/error（勿提前开启）
// - 测试文件保留 no-use-before-define 豁免（describe 回调引用外层 let 是常见模式）
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import vueParser from 'vue-eslint-parser'

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
  // 阶段2 再定级（先统计存量），现在保持关闭
  '@typescript-eslint/no-explicit-any': 'off',
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
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' }
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules
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
    // 测试文件放宽：先声明 helper 再使用是常见模式（describe 回调内引用外层 let）
    files: ['**/*.spec.ts', '**/*.test.ts', '**/__tests__/**/*.ts'],
    rules: { '@typescript-eslint/no-use-before-define': 'off' }
  }
]
