import { WgslReflect } from 'src/wgsl_reflect/wgsl_reflect.module';

const generateMip = `
struct VertexOut {
  @builtin(position) position : vec4f,
  @location(0) uv : vec2f,
}

@binding(0) @group(0) var mySampler: sampler;
@binding(1) @group(0) var myTexture: texture_2d<f32>;

@vertex @v_depth_off(0)
fn vertex_main(@builtin(vertex_index) index : u32) -> VertexOut
{
  var uv = vec2f(vec2u(index & 1,(index & 2)>>1));
  var output : VertexOut;
  output.position = vec4f(uv*vec2f(2.0,-2.0)+vec2f(-1.0,1.0), 0.5, 1);
  output.uv = uv;
  return output;
}

@fragment
fn fragment_main(fragData: VertexOut) -> @location(0) vec4f
{
  return textureSample(myTexture, mySampler, fragData.uv);
}
`;

const inputAttrs = {
  vec2f: { format: "float32x2", size: 8 },
  vec3f: { format: "float32x3", size: 12 },
  vec4f: { format: "float32x4", size: 16 },
  vec2i: { format: "int32x2", size: 8 },
  vec3i: { format: "int32x3", size: 12 },
  vec4i: { format: "int32x4", size: 16 }
};

export class Mne {
  constructor() {
    this.device = null;
  }
  async init() {
    if (!navigator.gpu) {
      throw Error("WebGPU not supported.");
    }

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) {
      throw Error("Couldn't request WebGPU adapter.");
    }

    // console.log(adapter);
    this.device = await adapter.requestDevice();
    this.copyShader = this.createPipeline(generateMip);
    this.quadIndex = this.createIndexBuffer(new Uint16Array([0, 1, 2, 2, 1, 3]));

  }

  createBuffers(mesh) {
    const device = this.device;
    const buffers = {};
    for (const key in mesh) {
      if (key == 'index') {
        const data = mesh[key];

        const buffer = device.createBuffer({
          size: data.byteLength, // make it big enough to store vertices in
          usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(buffer, 0, data, 0, buffer.length);
        buffer.indexFormat = (data instanceof Uint16Array) ? "uint16" : "uint32";
        buffers[key] = buffer;
      } else {
        const data = mesh[key];

        const buffer = device.createBuffer({
          size: data.byteLength, // make it big enough to store vertices in
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
        });
        device.queue.writeBuffer(buffer, 0, data, 0, buffer.length);
        buffers[key] = buffer;
      }
    }

    buffers.object = device.createBuffer({
      size: 512,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    return buffers;
  }

  createIndexBuffer(data) {
    const device = this.device;
    const buffer = device.createBuffer({
      size: data.byteLength, // make it big enough to store vertices in
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, data, 0, buffer.length);
    return buffer;
  }

  createTexture(imageBitmap) {
    const device = this.device;
    let v = imageBitmap.width;
    let mips = 0;
    while (v >>= 1) {
      mips++;
    }

    const texture = device.createTexture({
      size: [imageBitmap.width, imageBitmap.height, 1],
      format: 'rgba8unorm',
      mipLevelCount: mips,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
      { source: imageBitmap },
      { texture: texture },
      [imageBitmap.width, imageBitmap.height]
    );

    const commandEncoder = device.createCommandEncoder();
    for (let i = 1; i < mips; i++) {
      const renderPassDescriptor = {
        colorAttachments: [
          {
            loadOp: "clear",
            storeOp: "store",
            view: texture.createView({ baseMipLevel: i, mipLevelCount: 1 }),
          },
        ]
      };
      const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
      const actualPipeline = this.copyShader.getPipeline(texture.format);
      passEncoder.setPipeline(actualPipeline);
      const entries = [{
        binding: 1,
        resource: texture.createView({ baseMipLevel: i - 1, mipLevelCount: 1 })
      }];
      entries.push(...this.copyShader.bindings);
      passEncoder.setBindGroup(0, device.createBindGroup({
        layout: actualPipeline.getBindGroupLayout(0),
        entries: entries,
      }));
      passEncoder.setIndexBuffer(this.quadIndex, "uint16");
      passEncoder.drawIndexed(6);
      passEncoder.end();
    }

    device.queue.submit([commandEncoder.finish()]);

    return texture;
  }

  createPipeline(code) {
    const reflect = new WgslReflect(code);
    console.log(reflect);
    const regex = /@v_[^\(\)@]*\([^\(\)]*\)/g;
    // const result = code.replaceAll(regex, '');
    // console.log(result);
    const shaderModule = this.device.createShaderModule({
      code: code.replaceAll(regex, ''),
    });

    if (reflect.entry.vertex.length < 0) {
      throw new Error();
    }
    const vert = reflect.entry.vertex[0];
    const frag = reflect.entry.fragment[0];

    const inputs = [];
    const vertexBuffers = [];
    for (const buf of vert.inputs) {
      if (buf.locationType == "builtin")
        continue;
      const attr = inputAttrs[buf.type.name];
      vertexBuffers.push(
        {
          attributes: [
            {
              shaderLocation: buf.location, // 位置
              offset: 0,
              format: attr.format,
            },
          ],
          arrayStride: attr.size,
          stepMode: "vertex",
        });
      inputs.push(buf.name);
    }
    const bindings = [];
    const dynamicBindings = [];
    for (const samplerInfo of reflect.samplers) {
      let addrs = [];
      let maxAnisotropy = undefined;
      let compare = undefined;
      for (const attr of samplerInfo.node.attributes) {
        if (attr.name == "v_sampler_address") {
          addrs = attr.value;
          for (let i = 0; i < addrs.length; i++) {
            addrs[i] = addrs[i].replaceAll('_', '-');
          }
        }
        else if (attr.name == "v_max_anisotropy") {
          maxAnisotropy = attr.value;
        } else if (attr.name == "v_compare") {
          compare = attr.value;
        }
      }

      const sampler1 = this.device.createSampler({
        addressModeU: addrs[0],
        addressModeV: addrs[1],
        addressModeW: addrs[2],
        magFilter: "linear",
        minFilter: "linear",
        mipmapFilter: "linear",
        maxAnisotropy: maxAnisotropy,
        compare: compare
      });
      bindings.push({
        binding: samplerInfo.binding,
        resource: sampler1
      });
    }

    let depthOn = true;
    for (const attr of vert.node.attributes) {
      if (attr.name == "v_depth_off") {
        depthOn = false;
      }
    }

    for (const uniform of reflect.uniforms) {
      const bind = {
        binding: uniform.binding,
        uniformBind: 0
      }
      for (const attr of uniform.node.attributes) {
        if (attr.name == "v_bind") {
          bind.uniformBind = attr.value;
        }
      }
      dynamicBindings.push(bind);
      // console.log("uniform", dynamicBindings);
    }

    for (const textureInfo of reflect.textures) {
      const textureBind = {
        binding: textureInfo.binding,
        textureBind: undefined
      };
      for (const attr of textureInfo.node.attributes) {
        if (attr.name == "v_bind") {
          textureBind.textureBind = attr.value;
        }
      }
      dynamicBindings.push(textureBind);
    }


    const depthStencil = {
      depthWriteEnabled: true,
      depthCompare: 'less',
      format: 'depth24plus',
    };

    const pipelineDescriptor = {
      vertex: {
        module: shaderModule,
        entryPoint: vert.node.name,
        buffers: vertexBuffers,
      },
      primitive: {
        topology: "triangle-list",
      },
      layout: "auto",
      depthStencil: depthOn ? depthStencil : undefined,
    };
    if (frag) {
      pipelineDescriptor.fragment = {
        module: shaderModule,
        entryPoint: frag.node.name,
      };
      pipelineDescriptor.fragment.targets = [
        {
          format: "rgba8unorm",
        },
      ];
    }


    const renderPipeline = new MneRenderPipeline({
      inputs: inputs,
      bindings: bindings,
      dynamicBindings: dynamicBindings,
      descriptor: pipelineDescriptor,
      device: this.device
    });

    return renderPipeline;
  }

  createComputePipeline(code) {
    const reflect = new WgslReflect(code);
    console.log(reflect);
    const regex = /@v_[^\(\)@]*\([^\(\)]*\)/g;

    const shaderModule = this.device.createShaderModule({
      code: code.replaceAll(regex, ''),
    });
    const bindings = [];
    const dynamicBindings = [];

    for (const uniform of reflect.uniforms) {
      const bind = {
        binding: uniform.binding,
        uniformBind: 0
      }
      for (const attr of uniform.node.attributes) {
        if (attr.name == "v_bind") {
          bind.uniformBind = attr.value;
        }
      }
      dynamicBindings.push(bind);
    }
    for (const storage of reflect.storage) {
      const bind = {
        binding: storage.binding
      };
      for (const attr of storage.node.attributes) {
        if (attr.name == "v_bind") {
          bind.storageBind = attr.value;
        }
      }
      dynamicBindings.push(bind);
    }

    const pipeline = this.device.createComputePipeline({
      layout: "auto",
      compute: {
        module: shaderModule,
        entryPoint: "main"
      }
    });
    pipeline.bindings = bindings;
    pipeline.dynamicBindings = dynamicBindings;
    console.log(pipeline);
    return pipeline;

  }
}

export class MneRenderPipeline {
  constructor({ inputs, bindings, dynamicBindings, descriptor, device }) {
    this.inputs = inputs;
    this.bindings = bindings;
    this.dynamicBindings = dynamicBindings;
    this.descriptor = descriptor;
    this.device = device;
    this.cache = new Map();
  }

  getPipeline(format, depthFormat) {
    let identifier = "";
    if (format)
      identifier += format;
    if (depthFormat)
      identifier += depthFormat;
    const cache = this.cache.get(identifier);
    if (cache)
      return cache;

    if (format) {
      for (const target of this.descriptor.fragment.targets) {
        target.format = format;
      }
    }
    if (depthFormat) {
      console.log(this);
      const depthStencil = this.descriptor.depthStencil;
      depthStencil.format = depthFormat;
    }

    const renderPipeline = this.device.createRenderPipeline(this.descriptor);
    this.cache.set(identifier, renderPipeline);
    return renderPipeline;
  }
}