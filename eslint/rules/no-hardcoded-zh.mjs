// 自定义规则（阶段3）：禁止渲染层硬编码中文字符串，文案一律走 i18n t()。
// 覆盖：script 的字符串字面量 / 模板字符串；.vue 模板的文本节点（VText）与
// 静态属性值（如 placeholder="中文"）。注释与模块说明符不查。
// 存量文件由 eslint/zh-baseline.mjs 基线豁免，本规则只防新增。
const ZH = /[一-鿿]/

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: '禁止渲染层硬编码中文字符串（改用 i18n t()）' },
    messages: {
      zh: '硬编码中文字符串——请改用 i18n t()（翻译键见 src/renderer/src/i18n/messages）'
    },
    schema: []
  },
  create(context) {
    const check = (node, text) => {
      if (text && ZH.test(text)) context.report({ node, messageId: 'zh' })
    }
    const scriptVisitor = {
      Literal(node) {
        // 模块说明符（import/export ... from '...'）不会是文案，跳过
        const p = node.parent?.type
        if (p === 'ImportDeclaration' || p === 'ExportNamedDeclaration' || p === 'ExportAllDeclaration') return
        if (typeof node.value === 'string') check(node, node.value)
      },
      TemplateLiteral(node) {
        for (const q of node.quasis) check(q, q.value.cooked)
      }
    }
    // .vue 模板部分（vue-eslint-parser 提供 templateBodyVisitor）
    const services = context.sourceCode.parserServices
    if (services?.defineTemplateBodyVisitor) {
      return services.defineTemplateBodyVisitor(
        {
          VText(node) {
            check(node, node.value)
          },
          VAttribute(node) {
            // 仅静态属性（placeholder="中文"）；指令表达式由 scriptVisitor 覆盖
            if (!node.directive && node.value) check(node.value, node.value.value)
          }
        },
        scriptVisitor
      )
    }
    return scriptVisitor
  }
}
