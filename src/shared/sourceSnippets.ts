/**
 * 源码模式的增强提示片段：mcfunction 命令与 GLSL 着色器常用骨架。
 * 非表单化内容（函数、着色器管线）在源码模式下提供可点击插入的片段，
 * 降低手写门槛；片段仅追加/插入到光标处，不做参数化 UI。
 */

export interface SnippetItem {
  /** 按钮文字 */
  label: string
  /** 插入的文本 */
  text: string
  /** 悬停说明 */
  hint?: string
}

export interface SnippetGroup {
  label: string
  items: SnippetItem[]
}

/** mcfunction 常用命令片段 */
export const MCFUNCTION_SNIPPETS: SnippetGroup[] = [
  {
    label: '常用命令',
    items: [
      { label: 'give', text: 'give @p minecraft:diamond 1', hint: '给玩家物品' },
      { label: 'summon', text: 'summon minecraft:zombie ~ ~ ~', hint: '生成实体' },
      { label: 'tp', text: 'tp @s ~ ~10 ~', hint: '传送实体' },
      { label: 'setblock', text: 'setblock ~ ~ ~ minecraft:stone', hint: '放置方块' },
      { label: 'tellraw', text: 'tellraw @a {"text":"Hello from KunYu","color":"green"}', hint: '发送 JSON 文本' },
      { label: 'execute', text: 'execute if block ~ ~-1 ~ minecraft:stone run say 站在石头上', hint: '条件执行' },
      { label: 'scoreboard', text: 'scoreboard players add @p kunyu_score 1', hint: '计分板操作' },
      { label: 'function', text: 'function mymod:sub_function', hint: '调用其他函数' },
      { label: '注释', text: '# 这一行是注释', hint: 'mcfunction 用 # 注释' }
    ]
  },
  {
    label: '目标选择器',
    items: [
      { label: '@a', text: '@a', hint: '所有玩家' },
      { label: '@p', text: '@p', hint: '最近玩家' },
      { label: '@s', text: '@s', hint: '执行者自身' },
      { label: '@e', text: '@e', hint: '所有实体' },
      { label: '@e[type=]', text: '@e[type=minecraft:zombie,distance=..10]', hint: '带条件选择器' }
    ]
  }
]

/** GLSL 着色器常用骨架片段 */
export const GLSL_SNIPPETS: SnippetGroup[] = [
  {
    label: '着色器骨架',
    items: [
      {
        label: '顶点 main',
        text: 'void main() {\n    texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;\n    vertexColor = gl_Color;\n    gl_Position = ftransform();\n}\n',
        hint: '传统 GLSL 120 顶点入口'
      },
      {
        label: '片元 main',
        text: 'void main() {\n    vec4 albedo = texture2D(texture, texcoord) * vertexColor;\n    /* DRAWBUFFERS:0 */\n    gl_FragColor = albedo;\n}\n',
        hint: '片元入口 + 输出缓冲声明'
      },
      {
        label: 'uniform 声明',
        text: 'uniform sampler2D texture;\nuniform sampler2D lightmap;\nuniform mat4 gbufferModelViewInverse;\n',
        hint: 'OptiFine/Iris 内建 uniform'
      },
      {
        label: 'varying 声明',
        text: 'varying vec2 texcoord;\nvarying vec4 vertexColor;\n',
        hint: '顶点 → 片元传递'
      },
      { label: '#include', text: '#include "common"\n', hint: '引入 shaders/lib 下的公共库' },
      { label: 'DRAWBUFFERS', text: '/* DRAWBUFFERS:01 */\n', hint: '声明写入的 colortex 缓冲' },
      { label: '#version', text: '#version 120\n', hint: 'Iris/OptiFine 兼容版本声明' }
    ]
  },
  {
    label: '内建变量速查',
    items: [
      { label: 'gl_Vertex', text: 'gl_Vertex', hint: '顶点坐标（模型空间）' },
      { label: 'gl_MultiTexCoord0', text: 'gl_MultiTexCoord0', hint: '主纹理坐标' },
      { label: 'gl_Normal', text: 'gl_Normal', hint: '顶点法线' },
      { label: 'gl_Color', text: 'gl_Color', hint: '顶点颜色（含生物群系色调）' },
      { label: 'gl_ModelViewProjectionMatrix', text: 'gl_ModelViewProjectionMatrix', hint: 'MVP 矩阵' },
      { label: 'ftransform()', text: 'ftransform()', hint: '顶点 → 裁剪空间' },
      { label: 'texture2D()', text: 'texture2D(sampler, uv)', hint: '纹理采样' },
      { label: 'gl_FragColor', text: 'gl_FragColor', hint: '片元输出颜色' }
    ]
  }
]