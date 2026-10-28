# 资源包基础：创建、结构与打包

## 最小资源包结构

```
MyPack/
  pack.mcmeta          必需：包声明
  pack.png             可选：列表图标（方形 PNG，建议 128×128）
  assets/<ns>/         命名空间目录（小写字母/数字/下划线/连字符/点）
    textures/...       PNG 贴图
    models/...         模型 JSON
    lang/...           语言文件（en_us.json、zh_cn.json）
    sounds/... + sounds.json
```

pack.mcmeta：

```json
{
  "pack": {
    "pack_format": 48,
    "description": "我的第一个资源包",
    "supported_formats": { "min_inclusive": 46, "max_inclusive": 999 }
  }
}
```

- `pack_format` 随 MC 版本变化且必须写整数，具体取值查 minecraft.wiki「Pack format」页；写错不会崩，只在资源包列表里显示「版本不兼容」黄/红字，仍可强制加载
- 1.20.2+ 用 `supported_formats` 声明兼容区间，可消除跨版本警告
- JSON 必须是**无 BOM 的 UTF-8**；BOM 是最常见的「包不显示」原因之一

## 创建与调试流程

1. `.minecraft/resourcepacks/` 下新建文件夹（开发期直接用文件夹，不必打包）
2. 写 pack.mcmeta → 游戏内「选项 → 资源包」里应能看到包；看不到先查 BOM/JSON 语法
3. 改贴图/模型后 `F3+T` 热重载，不用重启
4. 发布时把 `pack.mcmeta + assets/` **直接**压成 zip——zip 根层就是这两样，不要再套一层 `MyPack/` 文件夹（套错层级是新手最高频翻车点）

## 命名空间规则

- 只允许小写字母、数字、`_`、`-`、`.`；大写字母会让整个包静默失效
- 自己的内容用自己的命名空间；`assets/minecraft/` 下的同名文件是**覆盖原版**，优先级按资源包排序决定，跨包覆盖原版要慎重

## 加载与优先级

- 资源包列表中**越靠上优先级越高**，同名文件上面的包赢
- 服务器可推送资源包：server.properties 里 `resource-pack=<直链>`；MC 圈反感网盘链接（慢且常失效），用直链
- 内置到整合包/模组的资源随 jar 加载，外部包可覆盖之

## 查看原版资源（学习/对照用）

- 客户端 `versions/<ver>/<ver>.jar` 用解压软件打开，`assets/minecraft/` 下就是全部原版贴图/模型/语言文件
- 查原版命名与目录约定时优先看这个，比猜快

> 本条目知识点结构参考了 B 站/抖音 UP 主「筱燚」的《数据包 / 资源包 / 实例》系列教程（第 9、41、46、50、52 期），正文按 Minecraft 官方 wiki 与公开文档重写。感谢社区创作者的整理与分享。
