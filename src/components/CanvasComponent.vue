<template>
  <div>
    <canvas ref="xy" v-touch-pan.prevent.mouse="handlePan" @wheel="onwheel"
      style="width:800px; height: 600px; max-width: 100%; max-height: 100%;"></canvas>
    <div style=" position: absolute; left: 30px; top: 30px;">
      <q-btn-toggle v-model="tool" glossy toggle-color="primary" :options="[
        { icon: 'fa-solid fa-hand', value: 0, accesskey: 'q' },
        { icon: 'fa-solid fa-rotate', value: 1, accesskey: 'w' },
        { icon: 'fa-solid fa-arrows-spin', value: 2, accesskey: 'r' },
        { icon: 'fa-solid fa-up-down-left-right', value: 3, accesskey: 't' }
      ]" />
      <q-btn :label="$t('fullScreen')" @click="requestFullscreen" />
      <q-btn :label="$t('changeShaderTest')" @click="changeOpaqueShader((opaqueShaderIndex + 1) % 2)" />
    </div>
  </div>
</template>

<script>
import { vec3, mat4, quat } from 'wgpu-matrix';
import { defineComponent } from 'vue'
import { Mne } from 'src/mne';
import { Renderer } from '../rendering/renderer'
import mneutilinit from '../../mneutil/mneutil'
import { skinning } from '../../mneutil/mneutil'

import { MMDAnimation } from '../MMD/MMDAnimation'

const opaqueVertDefine = `struct VertexOut {
  @builtin(position) position : vec4f,
  @location(0) color : vec4f,
  @location(1) uv : vec2f,
  @location(2) normal : vec3f,
  @location(3) shadow : vec3f
}
struct viewUniforms{
  viewProjection: mat4x4<f32>,
  shadowMatrix: mat4x4<f32>,
  lightDir: vec3f
}
struct ObjectUniforms{
  transform: mat4x4<f32>
}
@binding(0) @group(0) var<uniform> view: viewUniforms;
@v_bind(object)
@binding(1) @group(0) var<uniform> object: ObjectUniforms;
@v_sampler_address(repeat,repeat)
@v_max_anisotropy(16)
@binding(2) @group(0) var mySampler: sampler;
@v_bind(albedo)
@binding(3) @group(0) var myTexture: texture_2d<f32>;
@v_bind(shadowMap)
@binding(4) @group(0) var shadowTexture: texture_depth_2d;
@v_compare(less)
@binding(5) @group(0) var shadowSampler: sampler_comparison;

@vertex
fn vertex_main(@location(0) position: vec3f,
               @location(1) uv: vec2f,
               @location(2) normal: vec3f) -> VertexOut
{
  var position1 = object.transform * vec4f(position,1);
  var output : VertexOut;
  output.position = view.viewProjection * position1;
  output.color = vec4f(uv,1,1);
  output.uv = uv;
  output.normal = normal;
  output.shadow = (view.shadowMatrix * position1).xyz * vec3f(0.5,-0.5,1)+vec3f(0.5,0.5,0);
  return output;
}
`;

const opaqueShader = `
${opaqueVertDefine}
@fragment
fn fragment_main(fragData: VertexOut) -> @location(0) vec4f
{
  var norm = normalize(fragData.normal);
  var textureSize = textureDimensions(myTexture);
  var uv = fragData.uv;
  var color = textureSample(myTexture, mySampler, uv);
  var lightDir = view.lightDir;
  var light = clamp(dot(norm, lightDir), 0, 1);
  var shadowTest : f32 = textureSampleCompare(shadowTexture,shadowSampler, fragData.shadow.xy, fragData.shadow.z - 0.001);

  if(all(fragData.shadow > vec3f(0)) && all(fragData.shadow < vec3f(1))){
  }
  else{
    shadowTest = 1;
  }
  light = light * shadowTest * 0.5 + 0.5;

  return vec4f(color.rgb * light , 1);
}
`;
const opaqueShader2 = `
${opaqueVertDefine}

fn fwidth(e:vec2f) ->vec2f{
  return abs(dpdx(e)) + abs(dpdy(e));
}

fn pixelatedUV(uv: vec2f, textureSize: vec2f) -> vec2f{
  var xy = uv * textureSize;
  var alignxy = round(xy);
  return (alignxy + clamp((xy-alignxy) / fwidth(xy), vec2f(-0.5), vec2f(0.5))) / textureSize;
}

@fragment
fn fragment_main(fragData: VertexOut) -> @location(0) vec4f
{
  var norm = normalize(fragData.normal);
  var textureSize = textureDimensions(myTexture);
  var uv = fragData.uv;
  uv = pixelatedUV(uv, vec2f(textureSize));
  var color = textureSample(myTexture, mySampler, uv);
  var lightDir = view.lightDir;
  var light = clamp(dot(norm, lightDir), 0, 1);
  var shadowTest : f32 = textureSampleCompare(shadowTexture,shadowSampler, fragData.shadow.xy, fragData.shadow.z - 0.001);

  if(all(fragData.shadow > vec3f(0)) && all(fragData.shadow < vec3f(1))){
  }
  else{
    shadowTest = 1;
  }
  light = light * shadowTest * 0.5 + 0.5;

  return vec4f(color.rgb * light , 1);
}
`;

const shadowCastShader = `
struct viewUniforms{
  useless: mat4x4<f32>,
  viewProjection: mat4x4<f32>
}
struct ObjectUniforms{
  transform: mat4x4<f32>
}
@v_bind(0)
@binding(0) @group(0) var<uniform> view: viewUniforms;
@v_bind(object)
@binding(1) @group(0) var<uniform> object: ObjectUniforms;
@vertex
fn vertex_main(@location(0) position: vec3f) -> @builtin(position) vec4f
{
  return view.viewProjection * object.transform * vec4f(position,1);
}
`

const skinningShader = `
struct Uniforms{
  transform: mat4x4<f32>,
  vertexCount: u32,
  boneCount: u32
}
@v_bind(object)
@group(0) @binding(0)
var<uniform> object: Uniforms;
@group(0) @binding(1) @v_bind(position)
// var<storage, read_write> positions: array<vec3f>;
var<storage, read_write> positions: array<f32>;
@group(0) @binding(2) @v_bind(normal)
var<storage, read_write> normals: array<f32>;
@group(0) @binding(3) @v_bind(boneIndices)
var<storage, read> indice: array< vec2u >;
@group(0) @binding(4) @v_bind(boneWeights)
var<storage, read> weights: array<vec4f>;
@group(0) @binding(5) @v_bind(bones)
var<storage, read> matrice: array<mat4x4<f32>>;

@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id)
  global_id : vec3u,

  @builtin(local_invocation_id)
  local_id : vec3u,
) {
  var index = global_id.x;
  var index3 = index * 3;
  if(index >= object.vertexCount){
    return;
  }
  var origin = vec3f(positions[index3],positions[index3+1],positions[index3+2]);
  var originN = vec3f(normals[index3],normals[index3+1],normals[index3+2]);
  
  var boneIdx1 = indice[index];
  var boneIdx: vec4u;
  boneIdx[0]=boneIdx1[0] & 0xffff;
  boneIdx[1]=(boneIdx1[0] >> 16) & 0xffff;
  boneIdx[2]=boneIdx1[1] & 0xffff;
  boneIdx[3]=(boneIdx1[1] >> 16)& 0xffff;

  var weight = weights[index];

  var matrix = mat4x4<f32>();

  for (var i=0; i<4; i++){
    if( weight[i] <= 0.0 || boneIdx[i] > 4096){
      continue;
    }
    matrix += matrice[ boneIdx[i] ] * weight[i];
  }
  
  var position: vec3f = (matrix * vec4f(origin, 1)).xyz  ;
  var normal: vec3f = normalize(matrix * vec4f(originN, 0)).xyz ;
  // position = origin +  vec3(0,0,0);
  // normal = originN;
  positions[index3]= position[0];
  positions[index3+1]= position[1];
  positions[index3+2]= position[2];
  normals[index3]= normal[0];
  normals[index3+1]= normal[1];
  normals[index3+2]= normal[2];
}
`

export default defineComponent({
  name: 'CanvasComponent',
  data() {
    return {
      device: null,
      frame: null,
      frameCount: 0,
      mne: null,
      renderer: null,
      uniformBuffers: [],
      opaqueRender: null,
      opaqueRender2: null,
      shadowRender: null,
      gpuSkinning: null,
      context: null,
      selectedObject: null,
      temporaryBuffer: new Float32Array(1),
      previous: undefined,
      deltaTime: 0,
      opaqueShaderIndex: 0,
      camera: {
        center: [0, 10, 0],
        distance: 21,
        fov: 60 / 180 * Math.PI,
        near: 0.5,
        far: 5000,
        angle: [0, Math.PI, 0],
      },
      wasmReady: false,
    };
  },
  props: {
    objects: {}
  },
  emits: [
    "onRender",
    "onInit"
  ],
  computed: {
    tool: {
      get() {
        return this.$store.state.scene_tool.index;
      },
      set(value) {
        this.$store.commit('scene_tool/change', value);
      }
    }
  },
  mounted() {
    mneutilinit().then((instance) => {
      this.wasmReady = true;
    });

    this.init();
    this.$bus.on("resetCamera", this.resetCamera);
    this.$bus.on("selectChange", this.selectObjectChange);
  },
  unmounted() {
    cancelAnimationFrame(this.frame);
    this.$bus.off("resetCamera", this.resetCamera);
    this.$bus.off("selectChange", this.selectObjectChange);
    this.device.destroy();
  },
  methods: {
    async init() {
      this.mne = new Mne();
      await this.mne.init();
      this.renderer = new Renderer(this.mne);

      this.device = this.mne.device;

      //...
      this.renderInit();
      // this.compute();
    },

    async renderInit() {
      const device = this.device;

      const canvas = this.$refs.xy;

      const devicePixelRatio = window.devicePixelRatio || 1;

      canvas.width = canvas.clientWidth * devicePixelRatio;
      canvas.height = canvas.clientHeight * devicePixelRatio;

      const context = canvas.getContext("webgpu");
      this.context = context;

      context.configure({
        device: device,
        format: navigator.gpu.getPreferredCanvasFormat(),
        alphaMode: "premultiplied",
      });

      for (let i = 0; i < 4; i++) {
        const uniformBuffer = device.createBuffer({
          size: 64 * 4,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
        });
        this.uniformBuffers.push(uniformBuffer);
      }

      this.opaqueRender = this.mne.createPipeline(opaqueShader);
      this.opaqueRender2 = this.mne.createPipeline(opaqueShader2);
      this.shadowRender = this.mne.createPipeline(shadowCastShader);
      this.gpuSkinning = this.mne.createComputePipeline(skinningShader);

      for (const obj of this.objects) {
        if (obj.pmx)
          this.objPmx(obj);
      }

      this.renderFrame();
    },

    uniform0() {
      const canvas = this.$refs.xy;
      const device = this.device;
      const aspect = canvas.width / canvas.height;
      const camera = this.camera;
      const distance = camera.distance;

      const rot1 = mat4.rotateX(mat4.rotationY(camera.angle[1]), camera.angle[0]);
      const offset = vec3.mulScalar(vec3.transformMat4([0, 0, 1], rot1), distance);
      const center = camera.center;
      const up = vec3.mulScalar(vec3.transformMat4([0, 1, 0], rot1), distance);

      const v = mat4.lookAt(vec3.add(offset, center), center, up);
      const p = mat4.perspective(camera.fov, aspect, camera.near, camera.far);
      const vp = mat4.mul(p, v);

      const shadowv = mat4.lookAt([0, 40, -30], [0, 0, 0], [1, 0, 0]);
      const shadowp = mat4.ortho(-10, 10, -10, 10, 0, 100);
      const shadowvp = mat4.mul(shadowp, shadowv);

      const lightDir = vec3.normalize(vec3.transformMat4Upper3x3([0, 0, 1], mat4.transpose(shadowv)));

      const uniform = new Float32Array([...vp, ...shadowvp, ...lightDir]);
      const uniformBuffer = this.uniformBuffers[0];
      device.queue.writeBuffer(uniformBuffer, 0, uniform, 0);
    },
    renderFrame(timestamp) {
      if (this.previous === undefined) {
        this.previous = timestamp;
      }
      this.deltaTime = (timestamp - this.previous) / 1000;
      this.previous = timestamp;

      const canvas = this.$refs.xy;

      const devicePixelRatio = window.devicePixelRatio || 1;
      const width1 = canvas.clientWidth * devicePixelRatio;
      const height1 = canvas.clientHeight * devicePixelRatio;
      if (canvas.width != width1 || canvas.height != height1) {

        canvas.width = width1;
        canvas.height = height1;
      }

      this.$emit("onRender", this.device, this.$refs.xy);

      this.uniform0();

      this.renderObjects();
      this.frame = requestAnimationFrame(this.renderFrame);
      this.frameCount++;
    },
    renderObjects() {
      this.updateObjectsVert();
      this.renderer.uniformBuffers = this.uniformBuffers;
      this.renderer.render(this.context.getCurrentTexture(), this.objects);
    },
    updateObjectsVert() {
      const device = this.device;
      for (const obj of this.objects) {
        const animation = obj.animation;
        const positions = obj.pmx.positions;

        let tempsize = positions.length;
        if (this.temporaryBuffer.length < tempsize)
          this.temporaryBuffer = new Float32Array(tempsize);
        this.temporaryBuffer.set(positions);


        const vmd = obj.vmd;
        if (!vmd || !this.wasmReady) {
          continue;
        }
        if (this.deltaTime)
          animation.time += this.deltaTime;

        const vmd_frame = animation.time * 30;
        for (const morph of obj.pmx.morphs) {
          if (morph.type == 1) {

            const weight = MMDAnimation.morphWeight(vmd_frame, vmd.morphKeyframes.get(morph.name));
            if (weight < 1e-4)
              continue;

            skinning(morph.vertices.indices, morph.vertices.offsets, weight, this.temporaryBuffer);
          }
        }

        this.updateMatrices(animation, vmd);
        const bonesBuffer = obj.render.mesh.bones;
        for (let i = 0; i < animation.bones.length; i++) {
          const bone = animation.bones[i];
          bonesBuffer.set(bone.matrix, i * 16);
        }

        device.queue.writeBuffer(obj.render.gpuBuffers.position, 0, this.temporaryBuffer, 0, positions.length);
        device.queue.writeBuffer(obj.render.gpuBuffers.normal, 0, obj.render.mesh.normal);
        device.queue.writeBuffer(obj.render.gpuBuffers.bones, 0, bonesBuffer, 0, obj.render.mesh.bones.length);
      }
    },
    updateMatrices(animation, vmd) {
      const vmd_frame = animation.time * 30;
      const bones = animation.bones;
      for (const bone of bones) {
        [bone.animatePosition, bone.animateRotation] = MMDAnimation.boneMotion(vmd_frame, vmd.boneKeyframes.get(bone.name));
        this.updateBoneMatrix(bone, animation);
      }

      for (const bone of animation.ikbones) {
        const ikEnableKeyframes = vmd.ikenableKeyframes.get(bone.name);
        if (ikEnableKeyframes) {
          if (!ikEnableKeyframes[0].enable)
            continue;
        }

        const ik = bone.ik;
        const targetPosition = vec3.transformMat4(bone.position, bone.matrix);
        const ikNode = bones[bone.ik.ikTarget];

        const h1 = ik.ccdIterLim / 2;
        for (let i = 0; i < ik.ccdIterLim; i++) {
          const axis_lim = i < h1
          let ikPosition = vec3.transformMat4(ikNode.position, ikNode.matrix);

          if (vec3.distanceSq(targetPosition, ikPosition) < 1e-6) {
            break;
          }

          for (const chain of ik.links) {
            if (vec3.distanceSq(targetPosition, ikPosition) < 1e-6) {
              break;
            }
            const chainBone = bones[chain.linkedIndex];
            const chainParent = bones[chainBone.parent];
            const chainPosition = vec3.transformMat4(chainBone.position, chainBone.matrix);
            const c2d = vec3.sub(targetPosition, chainPosition);
            const nd = vec3.normalize(c2d);
            const c2e = vec3.sub(ikPosition, chainPosition);
            const ne = vec3.normalize(c2e);
            const cosin = Math.min(Math.max(vec3.dot(nd, ne), -1), 1);

            const inv = mat4.transpose(chainBone.matrix);

            const axis = this.safeNormalize(vec3.transformMat4Upper3x3(vec3.cross(nd, ne), inv));
            if (axis_lim && chain.fixAxis) {
              const fixIndex = chain.fixAxis - 1;
              for (let j = 0; j < 3; j++) {
                if (j == fixIndex) {
                  axis[j] = (axis[j] >= 0) ? 1 : -1;
                } else {
                  axis[j] = 0;
                }
              }
            }

            const limit = ik.ccdAngleLim * (i + 1);
            const turnAngle = -Math.min(Math.max(Math.acos(cosin), -limit), limit);
            let result = quat.normalize(quat.mul(chainBone.animateRotation, quat.fromAxisAngle(axis, turnAngle)));

            if (chain.hasLimit) {

              const angle = MMDAnimation.LimitAngle(result, axis_lim, chain.limitMin, chain.limitMax);

              result = quat.mul(quat.mul(quat.fromAxisAngle([0, 0, 1], angle[2]), quat.fromAxisAngle([1, 0, 0], angle[0])), quat.fromAxisAngle([0, 1, 0], angle[1]));
            }
            chainBone.animateRotation = result;
            const o1 = vec3.transformMat4Upper3x3(c2e, inv);
            ikPosition = vec3.add(chainPosition, vec3.transformMat4Upper3x3(vec3.transformQuat(o1, result), chainParent.matrix));
          }
          for (let j = ik.links.length - 1; j >= 0; j--) {
            const bone = bones[ik.links[j].linkedIndex];
            this.updateBoneMatrix(bone, animation);
          }
          this.updateBoneMatrix(ikNode, animation);
        }
      }
      for (const bone of bones) {
        this.updateBoneMatrix(bone, animation);
      }
    },
    safeNormalize(vec) {
      return vec3.divScalar(vec, Math.sqrt(Math.max(vec3.dot(vec, vec), 0.00001)));
    },
    updateBoneMatrix(bone, animation) {
      let position = vec3.add(bone.position, bone.animatePosition);
      let rotation = bone.animateRotation;
      const localMatrix = mat4.mul(mat4.mul(mat4.translation(position), mat4.fromQuat(rotation)), bone.inverse);
      if (bone.parent < animation.bones.length && bone.parent >= 0) {
        bone.matrix = mat4.mul(animation.bones[bone.parent].matrix, localMatrix);
      } else {
        bone.matrix = localMatrix;
      }
    },

    debugObj(obj) {
    },

    objPmx(obj) {
      const render = obj.render;
      const pmx = obj.pmx;
      render.mesh = MMDAnimation.pmxMesh(pmx);
      render.gpuBuffers = this.mne.createBuffers(render.mesh);
      render.passes = { opaque: this.opaqueRender, opaque2: this.opaqueRender2, shadow: this.shadowRender, skinning: this.gpuSkinning };
      render.textures = new Array(render.imageFiles.length);
      for (let i = 0; i < render.imageFiles.length; i++) {
        (async () => {
          const a = i;
          const imageFile = render.imageFiles[a];
          if (!imageFile)
            return;
          const imageBitmap = await createImageBitmap(await imageFile.getFile());
          render.textures[a] = this.mne.createTexture(imageBitmap);
          imageBitmap.close();
        })();
      }
      this.debugObj(obj);
    },
    destroyObjectResource(obj) {
      const render = obj.render;
      for (const key in render.gpuBuffers) {
        render.gpuBuffers[key]?.destroy();
      }
      for (const key in render.textures) {
        render.textures[key]?.destroy();
      }
      render.mesh = undefined;
      render.gpuBuffers = undefined;
      render.passes = undefined;
    },
    createObjectPmx(pmx, fileMap) {
      const obj = MMDAnimation.createMMDObject(pmx, fileMap);
      this.objPmx(obj);
      return obj;
    },
    selectObjectChange(object) {
      this.selectedObject = object;
    },
    onwheel(event) {
      event.preventDefault();
      this.camera.distance += event.deltaY * 0.025;
    },
    handlePan({ evt, delta, ...newInfo }) {
      // info.value = newInfo
      if (this.tool == 0) {
        const factor = 0.05;
        const rot1 = mat4.rotateX(mat4.rotationY(this.camera.angle[1]), this.camera.angle[0]);
        const up = vec3.transformMat4([0, 1, 0], rot1);
        const left = vec3.transformMat4([1, 0, 0], rot1);

        this.camera.center = vec3.add(vec3.add(vec3.mulScalar(left, -delta.x * factor), vec3.mulScalar(up, delta.y * factor)), this.camera.center);
      } else if (this.tool == 1) {
        this.camera.angle[1] -= delta.x * Math.PI / 180 * 0.5;
        this.camera.angle[0] -= delta.y * Math.PI / 180 * 0.5;
      } else if (this.tool == 2) {
        if (this.selectedObject) {
          const transform = this.selectedObject.transform;
          transform.rotation = quat.rotateY(transform.rotation, delta.x * Math.PI / 180 * 0.5);
        }
      } else if (this.tool == 3) {
        if (this.selectedObject) {
          const moveScale = 0.01;
          const rot = mat4.rotationY(this.camera.angle[1]);
          const forward = vec3.transformMat4([0, 0, 1], rot);
          const right = vec3.transformMat4([1, 0, 0], rot);
          const transform = this.selectedObject.transform;
          transform.position = vec3.add(transform.position, vec3.add(vec3.mulScalar(forward, delta.y * moveScale), vec3.mulScalar(right, delta.x * moveScale)));
        }
      }
    },
    resetCamera() {
      this.camera = {
        center: [0, 10, 0],
        distance: 15,
        fov: 60 / 180 * Math.PI,
        near: 0.5,
        far: 5000,
        angle: [0, Math.PI, 0],
      };
    },
    changeOpaqueShader(index) {
      if (index == 1) {
        this.renderer.opaqueName = "opaque2";
      } else {
        this.renderer.opaqueName = "opaque";
      }
      this.opaqueShaderIndex = index;
    },
    requestFullscreen() {
      this.$refs.xy.requestFullscreen();
    }
  }
})
</script>
