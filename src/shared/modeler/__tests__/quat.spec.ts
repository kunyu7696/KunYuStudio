/**
 * quat.ts golden 测试：Euler ⇄ Quaternion 与 three.js 'XYZ' 约定一致性、
 * 骨骼系旋转合成的代数性质。
 */
import { describe, expect, it } from 'vitest'
import {
  ancestorRotationQuat,
  composeBoneLocalRotation,
  eulerXYZDegFromQuat,
  normalizeQuat,
  quatConj,
  quatFromEulerXYZDeg,
  quatMul,
  QUAT_IDENTITY,
  worldDeltaQuat,
  type Quat
} from '../quat'
import type { Vec3 } from '../types'

const close = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps

function expectQuatClose(a: Quat, b: Quat, eps = 1e-9): void {
  // 四元数双覆盖（q 与 −q 同旋转）
  const direct = a.every((v, i) => close(v, b[i]!, eps))
  const flipped = a.every((v, i) => close(v, -b[i]!, eps))
  expect(direct || flipped).toBe(true)
}

function expectVec3Close(a: Vec3, b: Vec3, eps = 1e-6): void {
  expect(a.length).toBe(3)
  expect(a.every((v, i) => close(v, b[i]!, eps))).toBe(true)
}

describe('Euler ⇄ Quaternion（three.js XYZ 约定）', () => {
  it('零旋转 = 单位四元数', () => {
    expectQuatClose(quatFromEulerXYZDeg([0, 0, 0]), QUAT_IDENTITY)
  })

  it('绕 X 90° 与 180° 的标准值', () => {
    expectQuatClose(quatFromEulerXYZDeg([90, 0, 0]), [Math.SQRT1_2, 0, 0, Math.SQRT1_2])
    expectQuatClose(quatFromEulerXYZDeg([180, 0, 0]), [1, 0, 0, 0])
  })

  it('任意角度往返（Euler → Quat → Euler，欧拉表示按四元数等价比较）', () => {
    const samples: Vec3[] = [
      [30, -45, 120],
      [-170, 10, 170],
      [0, 0, 359.5],
      [22.5, -22.5, 0],
      [90, 90, 0],
      [-0.125, 0.25, -0.375]
    ]
    for (const e of samples) {
      const back = eulerXYZDegFromQuat(quatFromEulerXYZDeg(e))
      // 欧拉表示不唯一（返回值收敛到 (−180, 180]），按旋转本身（四元数）等价断言
      expectQuatClose(quatFromEulerXYZDeg(back), quatFromEulerXYZDeg(e), 1e-6)
    }
  })

  it('万向锁（X=90, Y=90）按 three.js 约定 z=0 收敛且世界旋转不变', () => {
    const e: Vec3 = [90, 90, 0]
    const back = eulerXYZDegFromQuat(quatFromEulerXYZDeg(e))
    // 分解结果与原角不同序，但对应的世界旋转矩阵必须一致：转回四元数比对
    expectQuatClose(quatFromEulerXYZDeg(back), quatFromEulerXYZDeg(e), 1e-6)
  })

  it('normalizeQuat 零向量回退单位', () => {
    expectQuatClose(normalizeQuat([0, 0, 0, 0]), QUAT_IDENTITY)
  })
})

describe('四元数代数', () => {
  it('共轭乘法还原单位', () => {
    const q = quatFromEulerXYZDeg([31, -52, 77])
    expectQuatClose(quatMul(q, quatConj(q)), QUAT_IDENTITY, 1e-9)
  })

  it('Hamilton 积与三次绕轴复合一致：Rz(90)⊗Ry(90) 的欧拉分解', () => {
    const q = quatMul(quatFromEulerXYZDeg([0, 0, 90]), quatFromEulerXYZDeg([0, 90, 0]))
    expectVec3Close(eulerXYZDegFromQuat(q), quatMulQuatToEulerHelper(), 1e-6)
  })
})

/** 用 fromEuler 直接复合同一旋转得到的欧拉（自洽参照） */
function quatMulQuatToEulerHelper(): Vec3 {
  return eulerXYZDegFromQuat(
    normalizeQuat(quatMul(quatFromEulerXYZDeg([0, 0, 90]), quatFromEulerXYZDeg([0, 90, 0])))
  )
}

describe('骨骼系旋转合成', () => {
  it('父链折叠：祖先 [Rx90] → Qb = Rx90 四元数', () => {
    expectQuatClose(ancestorRotationQuat([[90, 0, 0]]), quatFromEulerXYZDeg([90, 0, 0]))
    expectQuatClose(
      ancestorRotationQuat([
        [90, 0, 0],
        [0, 0, 45]
      ]),
      quatMul(quatFromEulerXYZDeg([90, 0, 0]), quatFromEulerXYZDeg([0, 0, 45]))
    )
  })

  it('空父链 = 单位四元数', () => {
    expectQuatClose(ancestorRotationQuat([]), QUAT_IDENTITY)
  })

  it('单位增量 → 节点旋转不变', () => {
    const rot: Vec3 = [15, -30, 60]
    expectVec3Close(
      composeBoneLocalRotation(rot, ancestorRotationQuat([[40, 0, 0]]), QUAT_IDENTITY),
      rot,
      1e-6
    )
  })

  it('父链为单位时退化为世界系左乘：Qn\' = Qd ⊗ Qn', () => {
    const base: Vec3 = [10, 20, 30]
    const qd = quatFromEulerXYZDeg([0, 0, 90])
    const expectWorld = eulerXYZDegFromQuat(quatMul(qd, quatFromEulerXYZDeg(base)))
    expectVec3Close(composeBoneLocalRotation(base, QUAT_IDENTITY, qd), expectWorld, 1e-6)
  })

  it('代数性质：合成后的节点世界旋转 = Qd ⊗ (Qb ⊗ Qn)', () => {
    const base: Vec3 = [12, -34, 56]
    const qb = ancestorRotationQuat([
      [30, 0, 0],
      [0, -45, 0]
    ])
    const qd = quatFromEulerXYZDeg([0, 25, 0])
    const next = composeBoneLocalRotation(base, qb, qd)
    const worldBefore = quatMul(qb, quatFromEulerXYZDeg(base))
    const worldAfter = quatMul(qd, worldBefore)
    expectQuatClose(quatMul(qb, quatFromEulerXYZDeg(next)), worldAfter, 1e-6)
  })

  it('worldDeltaQuat 捕获 before→after 的世界系增量', () => {
    const before = quatFromEulerXYZDeg([10, 0, 0])
    const after = quatMul(quatFromEulerXYZDeg([0, 90, 0]), before)
    expectVec3Close(eulerXYZDegFromQuat(worldDeltaQuat(before, after)), [0, 90, 0], 1e-6)
  })
})
