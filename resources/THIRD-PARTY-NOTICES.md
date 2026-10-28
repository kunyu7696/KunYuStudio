# 第三方声明（THIRD-PARTY-NOTICES）

本应用的分发包内包含经由 npm 依赖链引入的第三方组件。其中 `sharp`
（`@xenova/transformers` 的图像预处理硬依赖）在 `vendor/` 目录随包分发了
预编译的 libvips 及其传递原生库，多个库以 **LGPLv3** 授权（fribidi、
gdk-pixbuf、glib、libexif、libheif、librsvg、libvips、pango、proxy-libintl）。

上述原生库的完整许可清单以 sharp 官方 vendor 声明为准
（安装包内路径：`resources/app.asar.unpacked/node_modules/sharp/vendor/8.14.5/win32-x64/THIRD-PARTY-NOTICES.md`），
LGPLv3 的使用依据其"any later version"条款（LGPLv2 / LGPLv2.1 的后续版本条款）。

| 组件 | 许可 |
| --- | --- |
| sharp（含 vendor 内 libvips 及传递原生库） | MIT（库本体）；vendor 内第三方库许可见上表链接的官方清单，含 9 个 LGPLv3 库 |
| Electron | MIT |
| better-sqlite3 | MIT |
| onnxruntime-node | MIT |
| @xenova/transformers | Apache-2.0 |
| minecraft-data | MIT |
| npm（内置 DSH 插件安装 CLI） | Artistic-2.0（npm 自身及其依赖许可见包内 LICENSE 文件） |

本应用其余自有代码与语料（resources/knowledge 中文开发百科等）为 KunYu Studio 原创内容。
