// ESLint 最平配置（P2-J）：仅开 no-use-before-define（TS 感知版）。
// 用户要求：「最平」= 不引入 recommended 规则集，只抓「先使用后定义」这一类隐蔽 bug
//（TDZ 黑屏事故曾因此产生：ref/computed 在声明前被函数引用）。
// 第三周项13：.vue 纳入覆盖——vue-eslint-parser 解析 SFC，
// <script>/<script setup> 块仍交给 TS parser，规则与 .ts 完全一致，不新增 vue 规则集。
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import vueParser from 'vue-eslint-parser'

const noUseBeforeDefine = {
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
    rules: noUseBeforeDefine
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
    rules: noUseBeforeDefine
  },
  {
    // 测试文件放宽：先声明 helper 再使用是常见模式（describe 回调内引用外层 let）
    files: ['**/*.spec.ts', '**/*.test.ts', '**/__tests__/**/*.ts'],
    rules: { '@typescript-eslint/no-use-before-define': 'off' }
  }
]
