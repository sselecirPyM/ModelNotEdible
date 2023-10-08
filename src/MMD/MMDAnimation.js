import { vec3, mat4, quat } from 'wgpu-matrix';

export class MMDAnimation {
  static createMMDObject(pmx, fileMap) {
    const obj = {
      pmx: pmx,
      label: pmx.name,
      render: { imageFiles: [], materials: [] },
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1]
      },
      animation: {
        time: 0,
        bones: [],
        ikbones: [],
        boneIndices: pmx.boneIndices,
        boneWeights: pmx.boneWeights
      }
    };
    for (let i = 0; i < pmx.textures.length; i++) {
      const fileName = pmx.textures[i].replaceAll('\\', '/').toLowerCase();
      const file = fileMap.get(fileName);
      obj.render.imageFiles.push(file);
      if (!file)
        console.log("image not found", fileName);
    }
    for (const mat of pmx.materials) {
      obj.render.materials.push({
        triIndexCount: mat.triIndexCount,
        triIndexStart: mat.triIndexStart,
        albedo: mat.texture
      });
    }
    for (const bone of pmx.bones) {
      const bone1 = {
        name: bone.name,
        inverse: mat4.translation(vec3.mulScalar(bone.position, -1)),
        position: bone.position,
        animatePosition: vec3.zero(),
        animateRotation: quat.identity(),
        ikrotation: quat.identity(),
        parent: bone.parent,
        ik: bone.ik,
        matrix:
          [1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1]
      };
      obj.animation.bones.push(bone1);
      if (bone.ik) {
        obj.animation.ikbones.push(bone1);
      }
    }
    return obj;
  }

  static pmxMesh(pmx) {
    return {
      position: pmx.positions,
      normal: pmx.normals,
      uv: pmx.uvs,
      index: pmx.indices,
      boneIndices: pmx.boneIndices,
      boneWeights: pmx.boneWeights,
      bones: new Float32Array(pmx.bones.length * 16)
    };
  }

  static morphWeight(frame, keyframes) {
    if (!keyframes)
      return 0;

    if (keyframes.length == 1) {
      return keyframes[0].weight;
    }
    let left, right;
    [left, right] = this.getLeftRight(frame, keyframes);
    if (!right) {
      return keyframes[left].weight;
    }
    const rk = keyframes[right];
    const lk = keyframes[left];

    const length = rk.frame - lk.frame;
    const frame1 = (frame - lk.frame) / length;
    return frame1 * rk.weight + (1 - frame1) * lk.weight;
  }

  static boneMotion(frame, keyframes) {
    if (!keyframes)
      return [vec3.zero(), quat.identity()];
    if (keyframes.length == 1) {
      return [keyframes[0].translation, keyframes[0].rotation];
    }
    let left, right;
    [left, right] = MMDAnimation.getLeftRight(frame, keyframes);
    if (!right) {
      return [keyframes[left].translation, keyframes[left].rotation];
    }
    const rk = keyframes[right];
    const lk = keyframes[left];
    const length = rk.frame - lk.frame;
    const frame1 = (frame - lk.frame) / length;
    const rw = frame1;

    const rwr = MMDAnimation.vmdbezier(rk.ri, rw);
    const rw1 = [MMDAnimation.vmdbezier(rk.xi, rw), MMDAnimation.vmdbezier(rk.yi, rw), MMDAnimation.vmdbezier(rk.zi, rw)];
    for (let i = 0; i < 3; i++) {
      rw1[i] = lk.translation[i] * (1 - rw1[i]) + rk.translation[i] * rw1[i];
    }

    return [rw1, quat.slerp(lk.rotation, rk.rotation, rwr)];
  }

  static getLeftRight(frame, keyframes) {
    let left = 0;
    let right = keyframes.length - 1;
    if (frame > keyframes[right].frame) {
      return [right];
    }
    while (left < right - 1) {
      const mid = Math.floor((right + left) / 2);
      if (frame > keyframes[mid].frame) {
        left = mid;
      } else {
        right = mid;
      }
    }
    return [left, right];
  }

  static quatToXyz(quaternion) {
    const ii = quaternion[0] * quaternion[0];
    const jj = quaternion[1] * quaternion[1];
    const kk = quaternion[2] * quaternion[2];
    const ei = quaternion[3] * quaternion[0];
    const ej = quaternion[3] * quaternion[1];
    const ek = quaternion[3] * quaternion[2];
    const ij = quaternion[0] * quaternion[1];
    const ik = quaternion[0] * quaternion[2];
    const jk = quaternion[1] * quaternion[2];
    return [Math.atan2(2.0 * (ei - jk), 1 - 2.0 * (ii + jj)),
    Math.asin(2.0 * (ej + ik)),
    Math.atan2(2.0 * (ek - ij), 1 - 2.0 * (jj + kk))]
  }

  static quatToYzx(quaternion) {
    const ii = quaternion[0] * quaternion[0];
    const jj = quaternion[1] * quaternion[1];
    const kk = quaternion[2] * quaternion[2];
    const ei = quaternion[3] * quaternion[0];
    const ej = quaternion[3] * quaternion[1];
    const ek = quaternion[3] * quaternion[2];
    const ij = quaternion[0] * quaternion[1];
    const ik = quaternion[0] * quaternion[2];
    const jk = quaternion[1] * quaternion[2];

    return [Math.atan2(2.0 * (ei - jk), 1 - 2.0 * (ii + kk)),
    Math.atan2(2.0 * (ej - ik), 1 - 2.0 * (jj + kk)),
    Math.asin(2.0 * (ek + ij))]
  }

  static quatToZxy(quaternion) {
    const ii = quaternion[0] * quaternion[0];
    const jj = quaternion[1] * quaternion[1];
    const kk = quaternion[2] * quaternion[2];
    const ei = quaternion[3] * quaternion[0];
    const ej = quaternion[3] * quaternion[1];
    const ek = quaternion[3] * quaternion[2];
    const ij = quaternion[0] * quaternion[1];
    const ik = quaternion[0] * quaternion[2];
    const jk = quaternion[1] * quaternion[2];
    return [Math.asin(2.0 * (ei + jk)),
    Math.atan2(2.0 * (ej - ik), 1 - 2.0 * (ii + jj)),
    Math.atan2(2.0 * (ek - ij), 1 - 2.0 * (ii + kk))]
  }

  static LimitAngle(quat, axis_lim, low, high) {

    const angle = MMDAnimation.quatToZxy(quat);
    if (!axis_lim) {
      for (let i = 0; i < 3; i++) {
        angle[i] = Math.min(Math.max(angle[i], low[i]), high[i]);
      }
      return angle;
    }
    const vecL1 = [0, 0, 0];
    const vecH1 = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      vecL1[i] = 2.0 * low[i] - angle[i];
    }
    for (let i = 0; i < 3; i++) {
      vecH1[i] = 2.0 * high[i] - angle[i];
    }
    for (let i = 0; i < 3; i++) {
      if (angle[i] < low[i]) {
        angle[i] = (vecL1[i] <= high[i]) ? vecL1[i] : low[i];
      }
      else if (angle[i] > high[i]) {
        angle[i] = (vecH1[i] >= low[i]) ? vecH1[i] : high[i];
      }
    }
    return angle;
  }

  static vmdbezier(points, x) {
    // return MMDAnimation.bezier(points[0], points[2], points[1], points[3], x);
    return MMDAnimation.bezier2(points[0], points[2], points[1], points[3], x);
  }

  static bezier2(p1x, p2x, p1y, p2y, x) {

    if (x < 0) return 0;
    if (x > 1) return 1;

    const cx = 3.0 * p1x;
    const bx = 3.0 * (p2x - p1x) - cx;
    const ax = 1.0 - cx - bx;

    const cy = 3.0 * p1y;
    const by = 3.0 * (p2y - p1y) - cy;
    const ay = 1.0 - cy - by;
    const sampleCurveX = (t) => ((ax * t + bx) * t + cx) * t;
    const sampleCurveY = (t) => ((ay * t + by) * t + cy) * t;
    const sampleCurveDerivativeX = (t) => (3.0 * ax * t + 2.0 * bx) * t + cx;

    const epsilon = 1e-6;
    let t2 = x;
    for (let i = 0; i < 8; i++) {
      const x2 = sampleCurveX(t2) - x;
      if (Math.abs(x2) < epsilon) {
        return sampleCurveY(t2);
      }
      const d2 = sampleCurveDerivativeX(t2);
      if (Math.abs(d2) < epsilon)
        break;
      t2 -= x2 / d2;
    }
    let t0 = 0;
    let t1 = 1;
    t2 = x;

    while (t0 < t1) {
      const x2 = sampleCurveX(t2);
      if (Math.abs(x2 - x) < epsilon)
        return sampleCurveY(t2);
      if (x > x2)
        t0 = t2;
      else
        t1 = t2;
      t2 = (t1 - t0) * 0.5 + t0;
    }
    return sampleCurveY(t2);
  }

  static ipfunc(t, p1, p2) {
    return (1 + 3 * p1 - 3 * p2) * t * t * t + (3 * p2 - 6 * p1) * t * t + 3 * p1 * t;
  }

  static ipfuncd(t, p1, p2) {
    return (3 + 9 * p1 - 9 * p2) * t * t + (6 * p2 - 12 * p1) * t + 3 * p1;
  }
  static bezier(x1, x2, y1, y2, x) {
    let t, tt, v;
    t = x;
    while (true) {
      v = MMDAnimation.ipfunc(t, x1, x2) - x;
      if (v * v < 1e-7) {
        break;
      }
      tt = MMDAnimation.ipfuncd(t, x1, x2);
      if (tt === 0) {
        break;
      }
      t -= v / tt;
    }
    return MMDAnimation.ipfunc(t, y1, y2);
  }
}