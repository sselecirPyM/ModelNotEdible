
import { vec3, mat4, quat } from 'wgpu-matrix';

export class Renderer {
  constructor(mne) {
    this.mne = mne;
    this.device = mne.device;
    this.opaqueName = "opaque";

    const device = mne.device;


    this.defaultImage = device.createTexture({
      size: [1, 1, 1],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.writeTexture({ texture: this.defaultImage }, new Uint8Array([255, 255, 255, 255]), {}, { width: 1, height: 1 });

    this.shadowMap = device.createTexture({
      size: [1024, 1024],
      format: 'depth24plus',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  render(outputImage, objects) {
    const device = this.device;

    this.objects = objects;
    for (const obj of objects) {
      const render = obj.render;
      const mat = mat4.mul(mat4.translation(obj.transform.position), mat4.fromQuat(obj.transform.rotation));
      const uniform = new Float32Array([...mat]);
      let offset = uniform.length * 4;
      device.queue.writeBuffer(render.gpuBuffers.object, 0, uniform);
      const uniform2 = new Int32Array([
        render.mesh.position.length / 3,
        obj.animation.bones.length]);
      device.queue.writeBuffer(render.gpuBuffers.object, offset, uniform2);
    }

    if (!this.depthTexture || this.depthTexture.width != outputImage.width || this.depthTexture.height != outputImage.height) {
      this.depthTexture?.destroy();
      this.depthTexture = device.createTexture({
        size: [outputImage.width, outputImage.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }

    const commandEncoder = device.createCommandEncoder();
    this.gpuSkinning(commandEncoder);
    this.shadowPass(commandEncoder);
    this.opaquePass(commandEncoder, outputImage);
    device.queue.submit([commandEncoder.finish()]);
  }

  shadowPass(commandEncoder) {
    const renderPassDescriptor = {
      colorAttachments: [],
      depthStencilAttachment: {
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
        view: this.shadowMap.createView(),
      },
      depthFormat: this.shadowMap.format
    };

    this.renderPass(commandEncoder, renderPassDescriptor, "shadow");
  }

  opaquePass(commandEncoder, outputImage) {
    const renderPassDescriptor = {
      colorAttachments: [
        {
          clearValue: { r: 0.5, g: 0.5, b: 0.5, a: 1.0 },
          loadOp: "clear",
          storeOp: "store",
          view: outputImage.createView(),
        },
      ],
      depthStencilAttachment: {
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
        view: this.depthTexture.createView(),
      },
      format: outputImage.format,
      depthFormat: this.depthTexture.format
    };

    this.renderPass(commandEncoder, renderPassDescriptor, this.opaqueName);
  }

  renderPass(commandEncoder, passDescriptor, passName) {
    const passEncoder = commandEncoder.beginRenderPass(passDescriptor);

    const device = this.device;
    for (const obj of this.objects) {
      const render = obj.render;

      if (!render?.passes)
        continue;
      const renderPipeline = render.passes[passName];
      if (!renderPipeline)
        continue;

      const buffers = render.gpuBuffers;
      const actualPipeline = renderPipeline.getPipeline(passDescriptor.format, passDescriptor.depthFormat);
      passEncoder.setPipeline(actualPipeline);
      for (let i = 0; i < renderPipeline.inputs.length; i++) {
        const name = renderPipeline.inputs[i];
        passEncoder.setVertexBuffer(i, buffers[name]);
      }
      passEncoder.setIndexBuffer(buffers.index, buffers.index.indexFormat);

      for (const material of render.materials) {
        const entries = [];
        entries.push(...renderPipeline.bindings);
        for (const dy of renderPipeline.dynamicBindings) {
          let bind = {
            binding: dy.binding,
          };
          if (dy.textureBind != undefined) {
            bind.resource = (render.textures[material[dy.textureBind]] ?? this[dy.textureBind] ?? this.defaultImage).createView();
          }
          if (dy.uniformBind != undefined) {
            bind.resource = { buffer: buffers[dy.uniformBind] ?? this.uniformBuffers[dy.uniformBind], };
          }
          entries.push(bind);
        }

        const bindGroup = device.createBindGroup({
          layout: actualPipeline.getBindGroupLayout(0),
          entries: entries,
        });
        passEncoder.setBindGroup(0, bindGroup);

        passEncoder.drawIndexed(material.triIndexCount, 1, material.triIndexStart);
      }
    }
    passEncoder.end();
  }

  gpuSkinning(commandEncoder) {
    const passName = "skinning";
    const passEncoder = commandEncoder.beginComputePass();

    const device = this.device;

    for (const obj of this.objects) {
      if (!obj.vmd)
        continue;
      const render = obj.render;

      if (!render?.passes)
        continue;
      const renderPipeline = render.passes[passName];
      if (!renderPipeline)
        continue;

      const buffers = render.gpuBuffers;
      const entries = [];
      entries.push(...renderPipeline.bindings);
      for (const dy of renderPipeline.dynamicBindings) {
        let bind = {
          binding: dy.binding,
        };
        // if (dy.textureBind != undefined) {
        //   bind.resource = (render.textures[material[dy.textureBind]] ?? this[dy.textureBind] ?? this.defaultImage).createView();
        // }
        if (dy.uniformBind != undefined) {
          bind.resource = { buffer: buffers[dy.uniformBind] ?? this.uniformBuffers[dy.uniformBind], };
        }
        if (dy.storageBind != undefined) {
          bind.resource = { buffer: buffers[dy.storageBind] ?? this.uniformBuffers[dy.storageBind], };
        }
        entries.push(bind);
      }

      passEncoder.setPipeline(renderPipeline);

      const bindGroup = device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: entries,
      });
      passEncoder.setBindGroup(0, bindGroup);

      passEncoder.dispatchWorkgroups(Math.ceil(render.mesh.position.length / 3 / 64))

    }
    passEncoder.end();
  }
}