export class Pmx {
    async load(blob) {
        const reader = new BlobReader(blob);
        await reader.beginRead();
        if (reader.getInt32() != 0x20584D50) {
            throw Error("This is not a valid pmx file.");
        }
        const version = reader.getFloat32();

        const flagsSize = reader.getUint8();
        const isUtf8Encoding = reader.getUint8() != 0;
        const extraUVNumber = reader.getUint8();
        const vertexIndexSize = reader.getUint8();
        const textureIndexSize = reader.getUint8();
        const materialIndexSize = reader.getUint8();
        const boneIndexSize = reader.getUint8();
        const morphIndexSize = reader.getUint8();
        const rigidBodyIndexSize = reader.getUint8();

        const decoder = isUtf8Encoding ? new TextDecoder("UTF-8") : new TextDecoder("Unicode");
        const readStr = () => reader.getPmxStr(decoder);

        this.name = readStr();
        this.nameEN = readStr();
        this.description = readStr();
        this.descriptionEN = readStr();

        const vertCount = reader.getInt32();
        this.vertexCount = vertCount;
        this.positions = new Float32Array(vertCount * 3);
        this.normals = new Float32Array(vertCount * 3);
        this.uvs = new Float32Array(vertCount * 2);
        this.boneIndices = new Uint16Array(vertCount * 4);
        this.boneWeights = new Float32Array(vertCount * 4);
        this.edgeScales = new Float32Array(vertCount * 1);
        const idxReader8 = reader.getInt8.bind(reader);
        const idxReader16 = reader.getInt16.bind(reader);
        const idxReader32 = reader.getInt32.bind(reader);
        const idxReaderU8 = reader.getUint8.bind(reader);
        const idxReaderU16 = reader.getUint16.bind(reader);
        const idxReaderU32 = reader.getUint32.bind(reader);
        const getReader = (size) => {
            if (size == 1) return idxReader8;
            if (size == 2) return idxReader16;
            if (size == 4) return idxReader32;
            throw new Error();
        }
        const getUReader = (size) => {
            if (size == 1) return idxReaderU8;
            if (size == 2) return idxReaderU16;
            if (size == 4) return idxReaderU32;
            throw new Error();
        }

        const readVertBone = getUReader(boneIndexSize);
        const boneInvalid = 65535;

        for (let i = 0; i < vertCount; i++) {
            this.positions.set(reader.getFloat32Vec(3), i * 3);
            this.normals.set(reader.getFloat32Vec(3), i * 3);
            this.uvs.set(reader.getFloat32Vec(2), i * 2);

            if (extraUVNumber > 0) {
                for (let j = 0; j < extraUVNumber; j++) {
                    reader.getFloat32Vec(4);
                }
            }
            const skinningType = reader.getInt8();
            if (skinningType == PMX_DeformType.BDEF1) {
                this.boneIndices.set([readVertBone(), boneInvalid, boneInvalid, boneInvalid], i * 4);
                this.boneWeights.set([1, 0, 0, 0], i * 4);
            }
            else if (skinningType == PMX_DeformType.BDEF2) {
                this.boneIndices.set([readVertBone(), readVertBone(), boneInvalid, boneInvalid], i * 4);
                const weight = reader.getFloat32();
                this.boneWeights.set([weight, 1 - weight, 0, 0], i * 4);
            }
            else if (skinningType == PMX_DeformType.BDEF4) {
                this.boneIndices.set([readVertBone(), readVertBone(), readVertBone(), readVertBone()], i * 4);
                this.boneWeights.set(reader.getFloat32Vec(4), i * 4);
                // const totalWeight = this.boneWeights.reduce((prev, curr) => { return prev + curr });

            }
            else if (skinningType == PMX_DeformType.SDEF) {
                this.boneIndices.set([readVertBone(), readVertBone(), boneInvalid, boneInvalid], i * 4);
                const weight = reader.getFloat32();
                this.boneWeights.set([weight, 1 - weight, 0, 0], i * 4);
                reader.getFloat32Vec(3);
                reader.getFloat32Vec(3);
                reader.getFloat32Vec(3);
            }
            else {
                throw new Error();
            }
            this.edgeScales[i * 1] = reader.getFloat32();
        }

        const indexCount = reader.getInt32();
        this.indexCount = indexCount;
        const readVertIndex = getUReader(vertexIndexSize);
        this.indices = (vertexIndexSize == 2) ? new Uint16Array(indexCount + (indexCount & 1)) : new Uint32Array(indexCount);
        for (let i = 0; i < indexCount; i++) {
            this.indices[i] = readVertIndex();
        }
        const textureCount = reader.getInt32();
        this.textures = [];
        for (let i = 0; i < textureCount; i++) {
            this.textures.push(readStr());
        }
        const materialCount = reader.getInt32();
        const readMatIdx = getReader(textureIndexSize);
        let triOffset = 0;
        this.materials = [];
        for (let i = 0; i < materialCount; i++) {
            const mat = {};
            mat.name = readStr();
            mat.nameEN = readStr();
            mat.diffuse = reader.getFloat32Vec(4);
            mat.specular = reader.getFloat32Vec(4);
            mat.ambient = reader.getFloat32Vec(3);
            mat.drawFlag = reader.getUint8();
            mat.edgeColor = reader.getFloat32Vec(4);
            mat.edgeScale = reader.getFloat32();
            mat.texture = readMatIdx();
            mat.texture2 = readMatIdx();
            mat.texture2Flag = reader.getUint8();
            const useToon = reader.getUint8() != 0;
            if (useToon)
                mat.toon = reader.getInt8();
            else
                mat.toon = readMatIdx();
            mat.meta = readStr();
            mat.triIndexStart = triOffset;
            mat.triIndexCount = reader.getInt32();
            triOffset += mat.triIndexCount;
            this.materials.push(mat);

        }
        const readBoneIdx = getReader(boneIndexSize);
        const boneCount = reader.getInt32();
        this.bones = [];
        for (let i = 0; i < boneCount; i++) {
            const bone = {};
            bone.name = readStr();
            bone.nameEN = readStr();
            bone.position = reader.getFloat32Vec(3);
            bone.parent = readBoneIdx();
            bone.transformLevel = reader.getInt32();
            bone.flags = reader.getUint16();
            if (bone.flags & PMX_BoneFlag.ChildUseId) {
                bone.childId = readBoneIdx();
            } else {
                bone.childOffset = reader.getFloat32Vec(3);
            }
            if (bone.flags & PMX_BoneFlag.RotAxisFixed) {
                bone.rotFixed = reader.getFloat32Vec(3);
            }
            if ((bone.flags & PMX_BoneFlag.AcquireRotate) != 0 || (bone.flags & PMX_BoneFlag.AcquireTranslate) != 0) {
                bone.appendBoneIndex = readBoneIdx();
                bone.appendBoneRatio = reader.getFloat32();
            }
            if (bone.flags & PMX_BoneFlag.UseLocalAxis) {
                bone.localAxisX = reader.getFloat32Vec(3);
                bone.localAxisZ = reader.getFloat32Vec(3);
            }
            if (bone.flags & PMX_BoneFlag.ReceiveTransform) {
                bone.exportKey = reader.getInt32();
            }
            if (bone.flags & PMX_BoneFlag.HasIK) {
                const IK = {};
                IK.ikTarget = readBoneIdx();
                IK.ccdIterLim = reader.getInt32();
                IK.ccdAngleLim = reader.getFloat32();
                const ikLinkCount = reader.getInt32();
                IK.links = [];
                for (let j = 0; j < ikLinkCount; j++) {
                    const link = {};
                    link.linkedIndex = readBoneIdx();
                    link.hasLimit = reader.getInt8() != 0;
                    if (link.hasLimit) {
                        link.limitMin = reader.getFloat32Vec(3);
                        link.limitMax = reader.getFloat32Vec(3);

                        let a = 0;
                        for (let b = 0; b < 3; b++)
                            if (Math.abs(link.limitMin[b]) < 1e-6 && Math.abs(link.limitMax[b]) < 1e-6)
                                a |= 1 << b;
                        if (a == 6) {
                            link.fixAxis = 1;
                        } else if (a == 5) {
                            link.fixAxis = 2;
                        } else if (a == 3) {
                            link.fixAxis = 3;
                        }
                    }
                    IK.links.push(link);
                }
                bone.ik = IK;
            }
            this.bones.push(bone);
        }
        const readMaterialIndex = getReader(materialIndexSize);
        const readMorphIndex = getReader(morphIndexSize);
        const morphCount = reader.getInt32();
        this.morphs = [];
        for (let i = 0; i < morphCount; i++) {
            const morph = {};
            morph.name = readStr();
            morph.nameEN = readStr();
            morph.category = reader.getUint8();
            morph.type = reader.getUint8();

            const morphDataCount = reader.getInt32();
            switch (morph.type) {
                case PMX_MorphType.Group:
                    morph.groups = [];
                    for (let j = 0; j < morphDataCount; j++) {
                        const group = {};
                        group.index = readMorphIndex();
                        group.rate = reader.getFloat32();
                        morph.groups.push(group);
                    }
                    break;
                case PMX_MorphType.Vertex:
                    {
                        const morphVert = {};
                        morph.vertices = morphVert;
                        morphVert.indices = new Int32Array(morphDataCount);
                        morphVert.offsets = new Float32Array(morphDataCount * 3);

                        for (let j = 0; j < morphDataCount; j++) {
                            morphVert.indices[j] = readVertIndex();
                            morphVert.offsets.set(reader.getFloat32Vec(3), j * 3);
                        }
                    }
                    break;

                case PMX_MorphType.Bone:
                    morph.bones = [];
                    for (let j = 0; j < morphDataCount; j++) {
                        const bone = {};
                        bone.index = readBoneIdx();
                        bone.offset = reader.getFloat32Vec(3);
                        bone.rotation = reader.getFloat32Vec(4);
                        morph.bones.push(bone);
                    }
                    break;

                case PMX_MorphType.UV:
                case PMX_MorphType.ExtUV1:
                case PMX_MorphType.ExtUV2:
                case PMX_MorphType.ExtUV3:
                case PMX_MorphType.ExtUV4:
                    {
                        const morphUV = {};
                        morph.uvs = morphUV;
                        morphUV.indices = new Int32Array(morphDataCount);
                        morphUV.offsets = new Float32Array(morphDataCount * 2);
                        for (let j = 0; j < morphDataCount; j++) {
                            morphUV.indices[j] = readVertIndex();
                            morphUV.offsets.set(reader.getFloat32Vec(4), j * 2);
                        }
                    }
                    break;
                case PMX_MorphType.Material:
                    morph.materials = [];
                    for (let j = 0; j < morphDataCount; j++) {
                        const material = {};
                        material.index = readMaterialIndex();
                        material.morphMethod = reader.getUint8();
                        material.diffuse = reader.getFloat32Vec(4);
                        material.specular = reader.getFloat32Vec(4);
                        material.ambient = reader.getFloat32Vec(3);
                        material.edgeColor = reader.getFloat32Vec(4);
                        material.edgeScale = reader.getFloat32();
                        material.textureColor = reader.getFloat32Vec(4);
                        material.texture2Color = reader.getFloat32Vec(4);
                        material.toonColor = reader.getFloat32Vec(4);
                        morph.materials.push(material);
                    }
                    break;
                default:
                    throw new Error("unknown Morph Type");
            }
            this.morphs.push(morph);
        }
        const entryCount = reader.getInt32();
        for (let i = 0; i < entryCount; i++) {
            const entry = {};
            entry.name = readStr();
            entry.nameEN = readStr();
            reader.getUint8();
            const elementCount = reader.getInt32();
            entry.elements = [];
            for (let j = 0; j < elementCount; j++) {
                const element = {};
                element.type = reader.getUint8();
                if (element.type == 1) {
                    element.index = readMorphIndex();
                } else {
                    element.index = readBoneIdx();
                }
                entry.elements.push(element);
            }
        }
        const rigidBodyCount = reader.getInt32();
        this.rigidBodies = [];
        for (let i = 0; i < rigidBodyCount; i++) {
            const rigidBody = {};
            rigidBody.name = readStr();
            rigidBody.nameEN = readStr();
            rigidBody.boneIndex = readBoneIdx();
            rigidBody.collisionGroup = reader.getUint8();
            rigidBody.collisionMask = reader.getUint16();
            rigidBody.shape = reader.getUint8();
            rigidBody.size = reader.getFloat32Vec(3);
            rigidBody.position = reader.getFloat32Vec(3);
            rigidBody.rotation = reader.getFloat32Vec(3);
            rigidBody.mass = reader.getFloat32();
            rigidBody.tranDamp = reader.getFloat32();
            rigidBody.rotDamp = reader.getFloat32();
            rigidBody.restitution = reader.getFloat32();
            rigidBody.friction = reader.getFloat32();
            rigidBody.type = reader.getUint8();
            this.rigidBodies.push(rigidBody);
        }
        const constraintCount = reader.getInt32();
        const readRigidBodyIndex = getReader(rigidBodyIndexSize);
        this.constraints = [];
        for (let i = 0; i < constraintCount; i++) {
            const constraint = {};
            constraint.name = readStr();
            constraint.nameEN = readStr();
            constraint.type = reader.getUint8();
            constraint.rigidBody1 = readRigidBodyIndex();
            constraint.rigidBody2 = readRigidBodyIndex();
            constraint.position = reader.getFloat32Vec(3);
            constraint.rotation = reader.getFloat32Vec(3);
            constraint.positionMin = reader.getFloat32Vec(3);
            constraint.positionMax = reader.getFloat32Vec(3);
            constraint.rotationMin = reader.getFloat32Vec(3);
            constraint.rotationMax = reader.getFloat32Vec(3);
            constraint.positionSpring = reader.getFloat32Vec(3);
            constraint.rotationSpring = reader.getFloat32Vec(3);
            this.constraints.push(constraint);
        }
        this.toOpenGLMesh();
    }

    toOpenGLMesh() {
        for (let i = 0; i < this.positions.length; i += 3) {
            this.positions[i] = -this.positions[i];
        }
        for (let i = 0; i < this.normals.length; i += 3) {
            this.normals[i] = -this.normals[i];
        }
        for (let i = 0; i < this.bones.length; i++) {
            const bone = this.bones[i];
            bone.position[0] = -bone.position[0];

            if (bone.rotFixed) {
                bone.rotFixed[1] = -bone.rotFixed[1];
                bone.rotFixed[2] = -bone.rotFixed[2];
            }
            if (bone.childOffset) {
                bone.childOffset[0] = -bone.childOffset[0];
            }
            if (bone.localAxisX) {
                bone.localAxisX[0] = -bone.localAxisX[0];
                bone.localAxisZ[0] = -bone.localAxisZ[0];
            }
        }
        for (let i = 0; i < this.morphs.length; i++) {
            const morph = this.morphs[i];
            switch (morph.type) {
                case PMX_MorphType.Vertex:
                    {
                        const offsets = morph.vertices.offsets;
                        for (let j = 0; j < offsets.length; j += 3) {
                            offsets[j] = -offsets[j];
                        }
                        // for (let j = 0; j < morph.vertices.indices.length; j++) {
                        //     morph.vertices.offsets[j * 3] = -morph.vertices.offsets[j * 3];
                        // }
                    }
                    break;

                case PMX_MorphType.Bone:
                    for (let j = 0; j < morph.bones.length; j++) {
                        const bone = morph.bones[j];
                        bone.offset[0] = -bone.offset[0];
                        bone.rotation[1] = -bone.rotation[1];
                        bone.rotation[2] = -bone.rotation[2];
                    }
                    break;
                default:
                    break;
            }
        }

        for (let i = 0; i < this.rigidBodies.length; i++) {
            this.rigidBodies[i].position[0] = -this.rigidBodies[i].position[0];

            this.rigidBodies[i].rotation[1] = -this.rigidBodies[i].rotation[1];
            this.rigidBodies[i].rotation[2] = -this.rigidBodies[i].rotation[2];
        }
        for (let i = 0; i < this.constraints.length; i++) {
            this.constraints[i].position[0] = -this.constraints[i].position[0];

            this.constraints[i].rotation[1] = -this.constraints[i].rotation[1];
            this.constraints[i].rotation[2] = -this.constraints[i].rotation[2];
        }
    }
}

const PMX_MorphType = {
    Group: 0,
    Vertex: 1,
    Bone: 2,
    UV: 3,
    ExtUV1: 4,
    ExtUV2: 5,
    ExtUV3: 6,
    ExtUV4: 7,
    Material: 8
}

const PMX_DeformType = {
    BDEF1: 0,
    BDEF2: 1,
    BDEF4: 2,
    SDEF: 3,
    QDEF: 4
}
const PMX_BoneFlag = {
    ChildUseId: 1,
    Rotatable: 2,
    Movable: 4,
    Visible: 8,
    Controllable: 16,
    HasIK: 32,
    AcquireRotate: 256,
    AcquireTranslate: 512,
    RotAxisFixed: 1024,
    UseLocalAxis: 2048,
    PostPhysics: 4096,
    ReceiveTransform: 8192
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

    getPmxStr(decoder) {
        const size = this.getInt32();
        const dv = new DataView(this.buffer, this.offset, size);
        const result = decoder.decode(dv);
        this.offset += size;
        return result;
    }
}