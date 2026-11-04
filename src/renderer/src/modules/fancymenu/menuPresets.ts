import type {
  FmButton,
  FmElement,
  FmImage,
  FmSlides,
  FmText
} from '../../../../shared/types/fancymenu'

/** 模板元素名与文案（由调用方传入 i18n 结果，避免硬编码中文） */
export interface VanillaMenuLabels {
  background: string
  logo: string
  single: string
  multi: string
  realms: string
  mods: string
  options: string
  quit: string
  language: string
  accessibility: string
  version: string
  copyright: string
  langText: string
  accessText: string
  versionText: string
  copyrightText: string
}

/**
 * 原版主菜单模板：还原 MC 1.20 主界面的完整元素结构。
 * - 轮播全景背景铺满屏幕
 * - 标题 logo + 六个主按钮（单人/多人/Realms/模组/设置/退出）
 * - 左下语言与无障碍入口、版本号，右下版权文字
 * 坐标基于 anchor 相对偏移，切换分辨率后布局依然居中。
 */
export function buildVanillaMainMenu(
  screenW: number,
  screenH: number,
  l: VanillaMenuLabels
): FmElement[] {
  const BTN_W = 200
  const BTN_H = 20
  const BTN_X = -BTN_W / 2
  const list: FmElement[] = []

  const background: FmSlides = {
    id: 'fm_preset_bg',
    type: 'slides',
    name: l.background,
    anchor: 'top_left',
    x: 0,
    y: 0,
    width: screenW,
    height: screenH,
    z: 0,
    slides: [
      { type: 'image', path: 'minecraft:textures/gui/title/background/panorama_0.png' },
      { type: 'image', path: 'minecraft:textures/gui/title/background/panorama_1.png' },
      { type: 'image', path: 'minecraft:textures/gui/title/background/panorama_2.png' },
      { type: 'image', path: 'minecraft:textures/gui/title/background/panorama_3.png' }
    ],
    duration: 4000,
    fadeTime: 1200,
    fitType: 'stretch'
  }
  list.push(background)

  const logo: FmImage = {
    id: 'fm_preset_logo',
    type: 'image',
    name: l.logo,
    anchor: 'center',
    x: -137,
    y: -200,
    width: 274,
    height: 44,
    z: 10,
    url: 'minecraft:textures/gui/title/minecraft.png'
  }
  list.push(logo)

  const buttons: { id: string; name: string; y: number }[] = [
    { id: 'fm_preset_single', name: l.single, y: -78 },
    { id: 'fm_preset_multi', name: l.multi, y: -54 },
    { id: 'fm_preset_realms', name: l.realms, y: -30 },
    { id: 'fm_preset_mods', name: l.mods, y: -6 },
    { id: 'fm_preset_options', name: l.options, y: 18 },
    { id: 'fm_preset_quit', name: l.quit, y: 54 }
  ]
  buttons.forEach((b) => {
    const btn: FmButton = {
      id: b.id,
      type: 'button',
      name: b.name,
      anchor: 'center',
      x: BTN_X,
      y: b.y,
      width: BTN_W,
      height: BTN_H,
      z: 20,
      text: b.name,
      color: '#3a3f4a',
      hoverColor: '#4a5160'
    }
    list.push(btn)
  })

  const language: FmButton = {
    id: 'fm_preset_language',
    type: 'button',
    name: l.language,
    anchor: 'bottom_left',
    x: 6,
    y: -36,
    width: 22,
    height: 22,
    z: 30,
    text: l.langText
  }
  list.push(language)

  const accessibility: FmButton = {
    id: 'fm_preset_accessibility',
    type: 'button',
    name: l.accessibility,
    anchor: 'bottom_left',
    x: 32,
    y: -36,
    width: 22,
    height: 22,
    z: 30,
    text: l.accessText
  }
  list.push(accessibility)

  const version: FmText = {
    id: 'fm_preset_version',
    type: 'text',
    name: l.version,
    anchor: 'bottom_left',
    x: 6,
    y: -12,
    width: 200,
    height: 10,
    z: 30,
    text: l.versionText,
    size: 9
  }
  list.push(version)

  const copyright: FmText = {
    id: 'fm_preset_copyright',
    type: 'text',
    name: l.copyright,
    anchor: 'bottom_right',
    x: -6,
    y: -12,
    width: 340,
    height: 10,
    z: 30,
    text: l.copyrightText,
    size: 8
  }
  list.push(copyright)

  return list
}
