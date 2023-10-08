export class Vmd {
    constructor() {
        this.boneKeyframes = new Map();
        this.morphKeyframes = new Map();
        this.cameraKeyframes = [];
        this.lightKeyframes = [];
        this.shadowKeyframes = new Map();
        this.ikenableKeyframes = new Map();
    }
    async load(blob) {
        await this.load1(blob);
        this.toOpenGLCoord();
    }
    async load1(blob) {
        const reader = new BlobReader(blob);
        await reader.beginRead();
        reader.offset = 30;
        const decoder = new TextDecoder("shift_jis");
        this.modelName = reader.getStr(decoder, 20);
        const boneKeyframeCount = reader.getInt32();
        for (let i = 0; i < boneKeyframeCount; i++) {
            const boneName = reader.getStr(decoder, 15);
            const a = {};
            a.frame = reader.getInt32();
            a.translation = reader.getFloat32Vec(3);
            a.rotation = reader.getFloat32Vec(4);
            a.xi = Vmd.getInterpolator(reader);
            a.yi = Vmd.getInterpolator(reader);
            a.zi = Vmd.getInterpolator(reader);
            a.ri = Vmd.getInterpolator(reader);

            let keyframes = this.boneKeyframes.get(boneName);
            if (!keyframes) {
                keyframes = [];
                this.boneKeyframes.set(boneName, keyframes);
            }
            keyframes.push(a);
        }
        for (const value of this.boneKeyframes.values()) {
            value.sort((a, b) => a.frame - b.frame);
        }

        if (!reader.remain())
            return;
        const morphKeyframeCount = reader.getInt32();
        for (let i = 0; i < morphKeyframeCount; i++) {
            const morphName = reader.getStr(decoder, 15);
            const a = {};
            a.frame = reader.getInt32();
            a.weight = reader.getFloat32();

            let keyframes = this.morphKeyframes.get(morphName);
            if (!keyframes) {
                keyframes = [];
                this.morphKeyframes.set(morphName, keyframes);
            }
            keyframes.push(a);
        }
        for (const value of this.morphKeyframes.values()) {
            value.sort((a, b) => a.frame - b.frame);
        }
        if (!reader.remain())
            return;
        const cameraKeyframeCount = reader.getInt32();
        for (let i = 0; i < cameraKeyframeCount; i++) {
            const a = {};
            a.frame = reader.getInt32();
            a.distance = reader.getFloat32();
            a.position = reader.getFloat32Vec(3);
            a.rotation = reader.getFloat32Vec(3);
            a.xi = Vmd.getInterpolator(reader);
            a.yi = Vmd.getInterpolator(reader);
            a.zi = Vmd.getInterpolator(reader);
            a.ri = Vmd.getInterpolator(reader);
            a.di = Vmd.getInterpolator(reader);
            a.fi = Vmd.getInterpolator(reader);
            a.fov = reader.getInt32();
            a.orthographic = reader.getInt8() != 0;
            this.cameraKeyframes.push(a);
        }
        this.cameraKeyframes.sort((a, b) => a.frame - b.frame);
        if (!reader.remain())
            return;
        const lightKeyframeCount = reader.getInt32();
        for (let i = 0; i < lightKeyframeCount; i++) {
            const a = {};
            a.frame = reader.getInt32();
            a.color = reader.getFloat32Vec(3);
            a.position = reader.getFloat32Vec(3);
            this.lightKeyframes.push(a);
        }
        if (!reader.remain())
            return;
        const shadowKeyframeCount = reader.getInt32();
        for (let i = 0; i < shadowKeyframeCount; i++) {
            for (let j = 0; j < 9; j++)
                reader.getInt8();
        }
        if (!reader.remain())
            return;
        const ikKeyframeCount = reader.getInt32();
        for (let i = 0; i < ikKeyframeCount; i++) {
            const frame = reader.getInt32();
            const show = reader.getInt8() != 0;
            const frameCount = reader.getInt32();
            for (let j = 0; j < frameCount; j++) {
                const a = {};
                a.name = reader.getStr(decoder, 20);
                a.enable = reader.getInt8() != 0;
                a.frame = frame;
                let keyframes = this.ikenableKeyframes.get(a.name);
                if (!keyframes) {
                    keyframes = [];
                    this.ikenableKeyframes.set(a.name, keyframes);
                }
                keyframes.push(a);
            }

        }
        if (!reader.remain())
            return;
    }
    toOpenGLCoord() {
        for (const keyframes of this.boneKeyframes.values()) {
            for (const keyframe of keyframes) {
                keyframe.translation[0] = -keyframe.translation[0];

                const rotation = keyframe.rotation;
                rotation[1] = -rotation[1];
                rotation[2] = -rotation[2];
            }
        }
        for (const keyframe of this.cameraKeyframes) {
            const rotation = keyframe.rotation;
            rotation[1] = -rotation[1];
            rotation[2] = -rotation[2];
        }
    }

    static getInterpolator(reader) {
        const rate = 1 / 127;
        return [(((reader.getInt32() & 0xFF) ^ 0x80) - 0x80) * rate,
        (((reader.getInt32() & 0xFF) ^ 0x80) - 0x80) * rate,
        (((reader.getInt32() & 0xFF) ^ 0x80) - 0x80) * rate,
        (((reader.getInt32() & 0xFF) ^ 0x80) - 0x80) * rate]
    }
}


class BlobReader {
    constructor(blob) {
        this.blob = blob;
        this.offset = 0;
    }
    async beginRead() {
        this.buffer = await this.blob.arrayBuffer();
        this.view = new DataView(this.buffer);
    }

    getInt8() {
        const result = this.view.getInt8(this.offset);
        this.offset += 1;
        return result;
    }
    getInt16(littleEndian = true) {
        const result = this.view.getInt16(this.offset, littleEndian);
        this.offset += 2;
        return result;
    }
    getInt32(littleEndian = true) {
        const result = this.view.getInt32(this.offset, littleEndian);
        this.offset += 4;
        return result;
    }

    getFloat32(littleEndian = true) {
        const result = this.view.getFloat32(this.offset, littleEndian);
        this.offset += 4;
        return result;
    }
    getFloat32Vec(length, littleEndian = true) {
        const result = [];
        for (let i = 0; i < length; i++) {
            result.push(this.view.getFloat32(this.offset, littleEndian));
            this.offset += 4;
        }
        return result;
    }
    getUint8() {
        const result = this.view.getUint8(this.offset);
        this.offset += 1;
        return result;
    }
    getUint16(littleEndian = true) {
        const result = this.view.getUint16(this.offset, littleEndian);
        this.offset += 2;
        return result;
    }
    getUint32(littleEndian = true) {
        const result = this.view.getUint32(this.offset, littleEndian);
        this.offset += 4;
        return result;
    }

    getStr(decoder, size) {
        let textLength = 0;
        for (let i = 0; i < size; i++) {
            const i8 = this.view.getInt8(this.offset + i);
            if (i8)
                textLength++;
            else break;
        }
        const dv = new DataView(this.buffer, this.offset, textLength);
        const result = decoder.decode(dv);
        this.offset += size;
        return result;
    }

    remain() {
        return this.buffer.byteLength - this.offset;
    }
}