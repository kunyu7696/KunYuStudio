/**
 * 骨骼空间变换的四元数纯函数层（P3-d，方案 §4.8 变换空间）。
 *
 * 背景：ModelDocument 的 rotation 语义锚定 three.js/Java 的 Euler 'XYZ' 约定，
 * 节点世界旋转 = 父链各骨骼旋转的复合 ⊗ 自身旋转。骨骼空间 gizmo 需要：
 * 1. 由父链欧拉角求「骨骼世界四元数」Qb（根 → 直接父级顺序折叠）；
 * 2. 把 gizmo 产生的世界系增量四元数 Qd 合成回节点自身欧拉角：
 *    Qn' = conj(Qb) ⊗ Qd ⊗ Qb ⊗ Qn；
 * 3. Euler ⇄ Quaternion 双向换算与 three.js 'XYZ' 完全一致（golden 测试锁定）。
 *
 * 本层为纯数学：不依赖 DOM/three/Electron，全量可单测。
 */
import type { Vec3 } from './types'

/** 四元数 (x, y, z, w)，未归一化的输入会被调用方先归一化 */
export type Quat = [number, number, number, number]

const DEG2RAD = Math.PI / 180

/** 单位四元数 */
export const QUAT_IDENTITY: Quat = [0, 0, 0, 1]

/** Euler（度，three.js 'XYZ' 序）→ 四元数（公式与 three.js setFromEuler('XYZ') 一致） */
export function quatFromEulerXYZDeg(e: Vec3): Quat {
  const hx = (e[0] * DEG2RAD) / 2
  const hy = (e[1] * DEG2RAD) / 2
  const hz = (e[2] * DEG2RAD) / 2
  const c1 = Math.cos(hx)
  const s1 = Math.sin(hx)
  const c2 = Math.cos(hy)
  const s2 = Math.sin(hy)
  const c3 = Math.cos(hz)
  const s3 = Math.sin(hz)
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3
  ]
}

/** 四元数 → Euler（度，three.js 'XYZ' 序；公式与 three.js setFromRotationMatrix 一致） */
export function eulerXYZDegFromQuat(q: Quat): Vec3 {
  const [x, y, z, w] = normalizeQuat(q)
  const m13 = 2 * (x * z + y * w)
  const m23 = 2 * (y * z - x * w)
  const m33 = 1 - 2 * (x * x + y * y)
  const m12 = 2 * (x * y - z * w)
  const m11 = 1 - 2 * (y * y + z * z)
  const m32 = 2 * (y * z + x * w)
  const m22 = 1 - 2 * (x * x + z * z)
  const sy = Math.min(1, Math.max(-1, m13))
  let ex: number
  let ey: number
  let ez: number
  if (Math.abs(sy) < 0.9999999) {
    ex = Math.atan2(-m23, m33)
    ey = Math.asin(sy)
    ez = Math.atan2(-m12, m11)
  } else {
    // 万向锁： gimbal 轴合并，按 three.js 约定 z = 0
    ex = Math.atan2(m32, m22)
    ey = sy > 0 ? Math.PI / 2 : -Math.PI / 2
    ez = 0
  }
  return [ex / DEG2RAD, ey / DEG2RAD, ez / DEG2RAD]
}

/** Hamilton 积 a ⊗ b（先施 b 后施 a，世界系左乘约定） */
export function quatMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a
  const [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz
  ]
}

/** 共轭（逆元的负范数形式；输入需归一化） */
export function quatConj(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]]
}

/** 归一化（零向量防御：回退单位四元数） */
export function normalizeQuat(q: Quat): Quat {
  const len = Math.hypot(q[0], q[1], q[2], q[3])
  if (len < 1e-12) return [...QUAT_IDENTITY] as Quat
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len]
}

/**
 * 父链骨骼世界四元数：rots 按根 → 直接父级顺序折叠（acc = acc ⊗ Q_i）。
 * 组的 inner 平移层不携带旋转，因此世界旋转 = 各祖先 outer 旋转的复合。
 */
export function ancestorRotationQuat(rots: readonly Vec3[]): Quat {
  let acc = [...QUAT_IDENTITY] as Quat
  for (const r of rots) acc = quatMul(acc, quatFromEulerXYZDeg(r))
  return normalizeQuat(acc)
}

/** 世界系旋转增量：Qd = after ⊗ conj(before) */
export function worldDeltaQuat(before: Quat, after: Quat): Quat {
  return normalizeQuat(quatMul(after, quatConj(before)))
}

/**
 * 骨骼空间拖拽 → 节点自身欧拉角：
 * 世界期望 Qw' = Qd ⊗ Qw，其中 Qw = Qb ⊗ Qn；
 * 解出 Qn' = conj(Qb) ⊗ Qd ⊗ Qb ⊗ Qn，再转回欧拉（度）。
 */
export function composeBoneLocalRotation(
  baseEulerDeg: Vec3,
  ancestorQuat: Quat,
  worldDelta: Quat
): Vec3 {
  const qb = normalizeQuat(ancestorQuat)
  const qn = quatFromEulerXYZDeg(baseEulerDeg)
  const qnNext = quatMul(quatMul(quatConj(qb), normalizeQuat(worldDelta)), quatMul(qb, qn))
  return eulerXYZDegFromQuat(qnNext)
}
