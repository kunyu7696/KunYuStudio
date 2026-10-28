/**
 * 包编辑器的额外语言注册：GLSL、mcfunction 与 KubeJS 事件 API 片段。
 * Monaco 内置语言不含前两者，包"代码编辑"模式需要它们做语法高亮与注释切换；
 * KubeJS 脚本本身是 JavaScript（Monaco 内置），此处仅补 onEvent 代码片段补全。
 */
import { monaco } from './setup'

export { monaco }

let registered = false

const GLSL_KEYWORDS = [
  'attribute',
  'const',
  'uniform',
  'varying',
  'buffer',
  'shared',
  'coherent',
  'volatile',
  'restrict',
  'readonly',
  'writeonly',
  'layout',
  'centroid',
  'flat',
  'smooth',
  'noperspective',
  'patch',
  'sample',
  'break',
  'continue',
  'do',
  'for',
  'while',
  'switch',
  'case',
  'default',
  'if',
  'else',
  'subroutine',
  'in',
  'out',
  'inout',
  'discard',
  'return',
  'struct',
  'precision',
  'highp',
  'mediump',
  'lowp'
]

const GLSL_TYPES = [
  'void',
  'bool',
  'int',
  'uint',
  'float',
  'double',
  'vec2',
  'vec3',
  'vec4',
  'ivec2',
  'ivec3',
  'ivec4',
  'bvec2',
  'bvec3',
  'bvec4',
  'uvec2',
  'uvec3',
  'uvec4',
  'mat2',
  'mat3',
  'mat4',
  'mat2x2',
  'mat3x3',
  'mat4x4',
  'sampler1D',
  'sampler2D',
  'sampler3D',
  'samplerCube',
  'sampler2DShadow',
  'sampler2DArray'
]

const GLSL_BUILTINS = [
  'gl_Position',
  'gl_FragColor',
  'gl_FragData',
  'gl_FragCoord',
  'gl_Color',
  'gl_Vertex',
  'gl_Normal',
  'gl_MultiTexCoord0',
  'gl_MultiTexCoord1',
  'gl_TextureMatrix',
  'gl_ModelViewProjectionMatrix',
  'gl_ModelViewMatrix',
  'gl_ProjectionMatrix',
  'gl_NormalMatrix',
  'ftransform',
  'texture2D',
  'texture',
  'texture3D',
  'textureCube',
  'shadow2D',
  'mix',
  'clamp',
  'min',
  'max',
  'abs',
  'sign',
  'floor',
  'ceil',
  'fract',
  'mod',
  'pow',
  'exp',
  'log',
  'sqrt',
  'inversesqrt',
  'dot',
  'cross',
  'normalize',
  'length',
  'distance',
  'reflect',
  'refract',
  'smoothstep',
  'step',
  'sin',
  'cos',
  'tan',
  'atan',
  'asin',
  'acos',
  'matrixCompMult',
  'lessThan',
  'greaterThan',
  'any',
  'all',
  'not'
]

const GLSL_MONARCH = {
  defaultToken: '',
  tokenPostfix: '.glsl',
  keywords: GLSL_KEYWORDS,
  typeKeywords: GLSL_TYPES,
  builtins: GLSL_BUILTINS,
  operators: [
    '+',
    '-',
    '*',
    '/',
    '%',
    '=',
    '>',
    '<',
    '!',
    '~',
    '?',
    ':',
    '==',
    '<=',
    '>=',
    '!=',
    '&&',
    '||',
    '++',
    '--',
    '+=',
    '-=',
    '*=',
    '/=',
    '%='
  ],
  symbols: /[=><!~?:&|+\-*/^%]+/,
  tokenizer: {
    root: [
      [/#\s*\w+/, 'keyword.directive'],
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            '@typeKeywords': 'type',
            '@keywords': 'keyword',
            '@builtins': 'predefined',
            '@default': 'identifier'
          }
        }
      ],
      [/\d*\.\d+([eE][-+]?\d+)?[fF]?/, 'number.float'],
      [/\d+/, 'number'],
      [/"([^"\\]|\\.)*$/, 'string.invalid'],
      [/"/, 'string', '@string'],
      [/[{}()[\]]/, '@brackets'],
      [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],
      [/[;,.]/, 'delimiter']
    ],
    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment']
    ],
    string: [
      [/[^\\"]+/, 'string'],
      [/\\./, 'string.escape.invalid'],
      [/"/, 'string', '@pop']
    ]
  }
}

const MCFUNCTION_KEYWORDS = [
  'execute',
  'run',
  'if',
  'unless',
  'as',
  'at',
  'in',
  'positioned',
  'align',
  'anchored',
  'rotated',
  'facing',
  'store',
  'result',
  'data',
  'entity',
  'block',
  'score',
  'bossbar',
  'tag',
  'function',
  'give',
  'summon',
  'setblock',
  'fill',
  'clone',
  'tp',
  'teleport',
  'tellraw',
  'title',
  'scoreboard',
  'say',
  'tell',
  'msg',
  'kill',
  'clear',
  'effect',
  'enchant',
  'gamemode',
  'give',
  'particle',
  'playsound',
  'spreadplayers',
  'team',
  'trigger',
  'weather',
  'time',
  'difficulty',
  'gamerule',
  'forceload',
  'locate',
  'loot',
  'recipe',
  'advancement',
  'attribute',
  'damage',
  'item',
  'ride',
  'schedule',
  'setworldspawn',
  'spectate',
  'stopsound',
  'xp',
  'reload'
]

const MCFUNCTION_MONARCH = {
  defaultToken: '',
  tokenPostfix: '.mcfunction',
  ignoreCase: true,
  keywords: MCFUNCTION_KEYWORDS,
  tokenizer: {
    root: [
      [/#.*$/, 'comment'],
      [/@[a-zA-Z]/, 'variable.predefined'],
      [/\b\d+(\.\d+)?\b/, 'number'],
      [/[a-z_]\w*:[a-z_][\w./-]*/, 'type'],
      [/~|\^/, 'operator'],
      [/"([^"\\]|\\.)*$/, 'string.invalid'],
      [/"/, 'string', '@string'],
      [/[{}[\]]/, '@brackets'],
      [/[,:]/, 'delimiter'],
      [/[a-zA-Z_]\w*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }]
    ],
    string: [
      [/[^\\"]+/, 'string'],
      [/\\./, 'string.escape.invalid'],
      [/"/, 'string', '@pop']
    ]
  }
}

/** 注册 GLSL 与 mcfunction（幂等；Monaco monarch 定义较宽松，此处显式断言类型） */
export function registerPackLanguages(): void {
  if (registered) return
  registered = true

  monaco.languages.register({ id: 'glsl' })
  monaco.languages.setLanguageConfiguration('glsl', {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')']
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' }
    ]
  })
  monaco.languages.setMonarchTokensProvider(
    'glsl',
    GLSL_MONARCH as unknown as monaco.languages.IMonarchLanguage
  )

  monaco.languages.register({ id: 'mcfunction' })
  monaco.languages.setLanguageConfiguration('mcfunction', {
    comments: { lineComment: '#' },
    brackets: [
      ['{', '}'],
      ['[', ']']
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' }
    ]
  })
  monaco.languages.setMonarchTokensProvider(
    'mcfunction',
    MCFUNCTION_MONARCH as unknown as monaco.languages.IMonarchLanguage
  )

  registerKubejsSnippets()
}

/* ------------------------------ KubeJS 事件 API 片段 ------------------------------ */

interface KubejsSnippet {
  label: string
  insertText: string
  documentation: string
}

/** 常用 onEvent 骨架：标签以 kubejs: 前缀，便于补全列表识别来源 */
const KUBEJS_SNIPPETS: KubejsSnippet[] = [
  {
    label: 'kubejs: item.registry 注册物品',
    insertText: "onEvent('item.registry', event => {\n\tevent.create('${1:item_id}').displayName('${2:显示名}')\n})",
    documentation: '启动期：注册自定义物品（startup_scripts）'
  },
  {
    label: 'kubejs: block.registry 注册方块',
    insertText:
      "onEvent('block.registry', event => {\n\tevent.create('${1:block_id}')\n\t\t.displayName('${2:显示名}')\n\t\t.material('${3:stone}')\n\t\t.hardness(${4:1.5})\n\t\t.resistance(${5:6.0})\n})",
    documentation: '启动期：注册自定义方块（startup_scripts）'
  },
  {
    label: 'kubejs: recipes 配方事件',
    insertText:
      "onEvent('recipes', event => {\n\tevent.shaped('${1:output}', [\n\t\t'${2:AAA}',\n\t\t'${3:AAA}',\n\t\t'${4:AAA}'\n\t], {\n\t\t${5:A}: '${6:minecraft:stone}'\n\t})\n})",
    documentation: '服务端：有序/无序配方增删（server_scripts）'
  },
  {
    label: 'kubejs: server.load 服务器启动',
    insertText: "onEvent('server.load', event => {\n\t${1:// 服务器启动后执行}\n})",
    documentation: '服务端：服务器/存档加载完成'
  },
  {
    label: 'kubejs: player.logged_in 玩家登录',
    insertText: "onEvent('player.logged_in', event => {\n\tevent.player.tell('${1:欢迎！}')\n})",
    documentation: '服务端：玩家进入存档'
  },
  {
    label: 'kubejs: block.break 破坏方块',
    insertText: "onEvent('block.break', event => {\n\tif (event.block.id === '${1:minecraft:stone}') {\n\t\t${2:// 处理}\n\t}\n})",
    documentation: '服务端：玩家破坏方块事件'
  },
  {
    label: 'kubejs: item.right_click 右键物品',
    insertText: "onEvent('item.right_click', event => {\n\tif (event.item.id === '${1:item_id}') {\n\t\t${2:// 处理}\n\t}\n})",
    documentation: '服务端：玩家右键使用物品'
  },
  {
    label: 'kubejs: client.tick 客户端 tick',
    insertText: "onEvent('client.tick', event => {\n\t${1:// 每客户端 tick 执行}\n})",
    documentation: '客户端：逐 tick 事件（client_scripts）'
  }
]

/** 为内置 javascript 语言注册 KubeJS onEvent 片段补全（幂等由外层 registered 保证） */
function registerKubejsSnippets(): void {
  monaco.languages.registerCompletionItemProvider('javascript', {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position)
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn
      )
      const suggestions: monaco.languages.CompletionItem[] = KUBEJS_SNIPPETS.map((s) => ({
        label: s.label,
        kind: monaco.languages.CompletionItemKind.Snippet,
        insertText: s.insertText,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        documentation: s.documentation,
        range
      }))
      return { suggestions }
    }
  })
}