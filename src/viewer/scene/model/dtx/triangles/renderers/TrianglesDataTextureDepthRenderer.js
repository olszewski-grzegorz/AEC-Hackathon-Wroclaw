import {Program} from "../../../../webgl/Program.js";
import {math} from "../../../../math/math.js";
import {createRTCViewMat, getPlaneRTCPos} from "../../../../math/rtcCoords.js";

const tempVec3a = math.vec3();
const tempVec3b = math.vec3();
const tempVec3c = math.vec3();
const tempVec3d = math.vec3();
const tempMat4a = math.mat4();

/**
 * @private
 */
export class TrianglesDataTextureDepthRenderer {

    constructor(scene) {
        this._scene = scene;
        this._allocate();
        this._hash = this._getHash();
    }

    getValid() {
        return this._hash === this._getHash();
    };

    _getHash() {
        return this._scene._sectionPlanesState.getHash();
    }

    drawLayer(frameCtx, dataTextureLayer, renderPass) {

        const scene = this._scene;
        const camera = scene.camera;
        const model = dataTextureLayer.model;
        const gl = scene.canvas.gl;
        const state = dataTextureLayer._state;
        const textureState = state.textureState;
        const origin = dataTextureLayer._state.origin;
        const {position, rotationMatrix, rotationMatrixConjugate} = model;

        if (!this._program) {
            this._allocate();
            if (this.errors) {
                return;
            }
        }

        if (frameCtx.lastProgramId !== this._program.id) {
            frameCtx.lastProgramId = this._program.id;
            this._bindProgram(frameCtx, state);
        }

        textureState.bindCommonTextures(
            this._program,
            this.uTexturePerObjectPositionsDecodeMatrix,
            this._uTexturePerVertexIdCoordinates,
            this.uTexturePerObjectColorsAndFlags,
            this._uTexturePerObjectMatrix
        );

        let rtcViewMatrix;
        let rtcCameraEye;

        const gotOrigin = (origin[0] !== 0 || origin[1] !== 0 || origin[2] !== 0);
        const gotPosition = (position[0] !== 0 || position[1] !== 0 || position[2] !== 0);
        if (gotOrigin || gotPosition) {
            const rtcOrigin = tempVec3a;
            if (gotOrigin) {
                const rotatedOrigin = math.transformPoint3(rotationMatrix, origin, tempVec3b);
                rtcOrigin[0] = rotatedOrigin[0];
                rtcOrigin[1] = rotatedOrigin[1];
                rtcOrigin[2] = rotatedOrigin[2];
            } else {
                rtcOrigin[0] = 0;
                rtcOrigin[1] = 0;
                rtcOrigin[2] = 0;
            }
            rtcOrigin[0] += position[0];
            rtcOrigin[1] += position[1];
            rtcOrigin[2] += position[2];
            rtcViewMatrix = createRTCViewMat(camera.viewMatrix, rtcOrigin, tempMat4a);
            rtcCameraEye = tempVec3c;
            rtcCameraEye[0] = camera.eye[0] - rtcOrigin[0];
            rtcCameraEye[1] = camera.eye[1] - rtcOrigin[1];
            rtcCameraEye[2] = camera.eye[2] - rtcOrigin[2];
        } else {
            rtcViewMatrix = camera.viewMatrix;
            rtcCameraEye = camera.eye;
        }

        gl.uniformMatrix4fv(this._uSceneModelMatrix, false, rotationMatrixConjugate);
        gl.uniformMatrix4fv(this._uViewMatrix, false, rtcViewMatrix);
        gl.uniformMatrix4fv(this._uProjMatrix, false, camera.projMatrix);
        gl.uniform3fv(this._uCameraEyeRtc, rtcCameraEye);
        gl.uniform1i(this._uRenderPass, renderPass);

        if (scene.logarithmicDepthBufferEnabled) {
            const logDepthBufFC = 2.0 / (Math.log(frameCtx.pickZFar + 1.0) / Math.LN2);
            gl.uniform1f(this._uLogDepthBufFC, logDepthBufFC);
        }

        const numSectionPlanes = scene._sectionPlanesState.sectionPlanes.length;
        if (numSectionPlanes > 0) {
            const sectionPlanes = scene._sectionPlanesState.sectionPlanes;
            const baseIndex = dataTextureLayer.layerIndex * numSectionPlanes;
            const renderFlags = model.renderFlags;
            for (let sectionPlaneIndex = 0; sectionPlaneIndex < numSectionPlanes; sectionPlaneIndex++) {
                const sectionPlaneUniforms = this._uSectionPlanes[sectionPlaneIndex];
                if (sectionPlaneUniforms) {
                    const active = renderFlags.sectionPlanesActivePerLayer[baseIndex + sectionPlaneIndex];
                    gl.uniform1i(sectionPlaneUniforms.active, active ? 1 : 0);
                    if (active) {
                        const sectionPlane = sectionPlanes[sectionPlaneIndex];
                        if (origin) {
                            const rtcSectionPlanePos = getPlaneRTCPos(sectionPlane.dist, sectionPlane.dir, origin, tempVec3d);
                            gl.uniform3fv(sectionPlaneUniforms.pos, rtcSectionPlanePos);
                        } else {
                            gl.uniform3fv(sectionPlaneUniforms.pos, sectionPlane.pos);
                        }
                        gl.uniform3fv(sectionPlaneUniforms.dir, sectionPlane.dir);
                    }
                }
            }
        }

        if (state.numIndices8Bits > 0) {
            textureState.bindTriangleIndicesTextures(
                this._program,
                this._uTexturePerPolygonIdPortionIds,
                this._uTexturePerPolygonIdIndices,
                8 // 8 bits indices
            );

            gl.drawArrays(gl.TRIANGLES, 0, state.numIndices8Bits);
        }

        if (state.numIndices16Bits > 0) {
            textureState.bindTriangleIndicesTextures(
                this._program,
                this._uTexturePerPolygonIdPortionIds,
                this._uTexturePerPolygonIdIndices,
                16 // 16 bits indices
            );

            gl.drawArrays(gl.TRIANGLES, 0, state.numIndices16Bits);
        }

        if (state.numIndices32Bits > 0) {
            textureState.bindTriangleIndicesTextures(
                this._program,
                this._uTexturePerPolygonIdPortionIds,
                this._uTexturePerPolygonIdIndices,
                32 // 32 bits indices
            );

            gl.drawArrays(gl.TRIANGLES, 0, state.numIndices32Bits);
        }

        frameCtx.drawElements++;
    }

    _allocate() {

        const scene = this._scene;
        const gl = scene.canvas.gl;

        this._program = new Program(gl, this._buildShader());

        if (this._program.errors) {
            this.errors = this._program.errors;
            return;
        }

        const program = this._program;

        this._uRenderPass = program.getLocation("renderPass");
        this._uPositionsDecodeMatrix = program.getLocation("objectDecodeAndInstanceMatrix");
        this._uSceneModelMatrix = program.getLocation("sceneModelMatrix");
        this._uViewMatrix = program.getLocation("viewMatrix");
        this._uProjMatrix = program.getLocation("projMatrix");
        this._uSectionPlanes = [];

        for (let i = 0, len = scene._sectionPlanesState.sectionPlanes.length; i < len; i++) {
            this._uSectionPlanes.push({
                active: program.getLocation("sectionPlaneActive" + i),
                pos: program.getLocation("sectionPlanePos" + i),
                dir: program.getLocation("sectionPlaneDir" + i)
            });
        }

        if (scene.logarithmicDepthBufferEnabled) {
            this._uLogDepthBufFC = program.getLocation("logDepthBufFC");
        }

        this.uTexturePerObjectPositionsDecodeMatrix = "uObjectPerObjectPositionsDecodeMatrix";
        this.uTexturePerObjectColorsAndFlags = "uObjectPerObjectColorsAndFlags";
        this._uTexturePerVertexIdCoordinates = "uTexturePerVertexIdCoordinates";
        this._uTexturePerPolygonIdNormals = "uTexturePerPolygonIdNormals";
        this._uTexturePerPolygonIdIndices = "uTexturePerPolygonIdIndices";
        this._uTexturePerPolygonIdPortionIds = "uTexturePerPolygonIdPortionIds";
        this._uTexturePerObjectMatrix= "uTexturePerObjectMatrix";
        this._uCameraEyeRtc = program.getLocation("uCameraEyeRtc");
    }

    _bindProgram(frameCtx) {

        const scene = this._scene;
        const gl = scene.canvas.gl;
        const program = this._program;
        const project = scene.camera.project;

        program.bind();

        gl.uniformMatrix4fv(this._uProjMatrix, false, project.matrix);

        if (scene.logarithmicDepthBufferEnabled) {
            const logDepthBufFC = 2.0 / (Math.log(project.far + 1.0) / Math.LN2);
            gl.uniform1f(this._uLogDepthBufFC, logDepthBufFC);
        }
    }

    _buildShader() {
        return {
            vertex: this._buildVertexShader(),
            fragment: this._buildFragmentShader()
        };
    }

    _buildVertexShader() {
        const scene = this._scene;
        const sectionPlanesState = scene._sectionPlanesState;
        const lightsState = scene._lightsState;
        const clipping = sectionPlanesState.sectionPlanes.length > 0;
        let light;
        const src = [];
        src.push("#version 300 es");
        src.push("// Triangles dataTexture draw vertex shader");

        src.push("#ifdef GL_FRAGMENT_PRECISION_HIGH");
        src.push("precision highp float;");
        src.push("precision highp int;");
        src.push("precision highp usampler2D;");
        src.push("precision highp isampler2D;");
        src.push("precision highp sampler2D;");
        src.push("#else");
        src.push("precision mediump float;");
        src.push("precision mediump int;");
        src.push("precision mediump usampler2D;");
        src.push("precision mediump isampler2D;");
        src.push("precision mediump sampler2D;");
        src.push("#endif");

        src.push("uniform int renderPass;");

        if (scene.entityOffsetsEnabled) {
            src.push("in vec3 offset;");
        }

        src.push("uniform mat4 sceneModelMatrix;");
        src.push("uniform mat4 viewMatrix;");
        src.push("uniform mat4 projMatrix;");

        src.push("uniform highp sampler2D uObjectPerObjectPositionsDecodeMatrix;");
        src.push("uniform highp sampler2D uTexturePerObjectMatrix;");
        src.push("uniform lowp usampler2D uObjectPerObjectColorsAndFlags;");
        src.push("uniform mediump usampler2D uTexturePerVertexIdCoordinates;");
        src.push("uniform highp usampler2D uTexturePerPolygonIdIndices;");
        src.push("uniform mediump usampler2D uTexturePerPolygonIdPortionIds;");
        src.push("uniform vec3 uCameraEyeRtc;");

        src.push("vec3 positions[3];")

        if (scene.logarithmicDepthBufferEnabled) {
            src.push("uniform float logDepthBufFC;");
            src.push("out float vFragDepth;");
            src.push("out float isPerspective;");
        }

        src.push("bool isPerspectiveMatrix(mat4 m) {");
        src.push("    return (m[2][3] == - 1.0);");
        src.push("}");

        src.push("out highp vec2 vHighPrecisionZW;");

        if (clipping) {
            src.push("out vec4 vWorldPosition;");
            src.push("flat out uint vFlags2;");
        }

        src.push("void main(void) {");

        // constants
        src.push("int polygonIndex = gl_VertexID / 3;")

        // get packed object-id
        src.push("int h_packed_object_id_index = (polygonIndex >> 3) & 4095;")
        src.push("int v_packed_object_id_index = (polygonIndex >> 3) >> 12;")

        src.push("int objectIndex = int(texelFetch(uTexturePerPolygonIdPortionIds, ivec2(h_packed_object_id_index, v_packed_object_id_index), 0).r);");
        src.push("ivec2 objectIndexCoords = ivec2(objectIndex % 512, objectIndex / 512);");

        // get flags & flags2
        src.push("uvec4 flags = texelFetch (uObjectPerObjectColorsAndFlags, ivec2(objectIndexCoords.x*8+2, objectIndexCoords.y), 0);");
        src.push("uvec4 flags2 = texelFetch (uObjectPerObjectColorsAndFlags, ivec2(objectIndexCoords.x*8+3, objectIndexCoords.y), 0);");

        // flags.x = NOT_RENDERED | COLOR_OPAQUE | COLOR_TRANSPARENT
        // renderPass = COLOR_OPAQUE

        src.push(`if (int(flags.x) != renderPass) {`);
        src.push("   gl_Position = vec4(3.0, 3.0, 3.0, 1.0);"); // Cull vertex
        src.push("   return;"); // Cull vertex
        src.push("} else {");

        // get vertex base
        src.push("ivec4 packedVertexBase = ivec4(texelFetch (uObjectPerObjectColorsAndFlags, ivec2(objectIndexCoords.x*8+4, objectIndexCoords.y), 0));");

        src.push("ivec4 packedIndexBaseOffset = ivec4(texelFetch (uObjectPerObjectColorsAndFlags, ivec2(objectIndexCoords.x*8+5, objectIndexCoords.y), 0));");

        src.push("int indexBaseOffset = (packedIndexBaseOffset.r << 24) + (packedIndexBaseOffset.g << 16) + (packedIndexBaseOffset.b << 8) + packedIndexBaseOffset.a;");

        src.push("int h_index = (polygonIndex - indexBaseOffset) & 4095;")
        src.push("int v_index = (polygonIndex - indexBaseOffset) >> 12;")

        src.push("ivec3 vertexIndices = ivec3(texelFetch(uTexturePerPolygonIdIndices, ivec2(h_index, v_index), 0));");
        src.push("ivec3 uniqueVertexIndexes = vertexIndices + (packedVertexBase.r << 24) + (packedVertexBase.g << 16) + (packedVertexBase.b << 8) + packedVertexBase.a;")

        src.push("ivec3 indexPositionH = uniqueVertexIndexes & 4095;")
        src.push("ivec3 indexPositionV = uniqueVertexIndexes >> 12;")

        src.push("mat4 objectInstanceMatrix = mat4 (texelFetch (uTexturePerObjectMatrix, ivec2(objectIndexCoords.x*4+0, objectIndexCoords.y), 0), texelFetch (uTexturePerObjectMatrix, ivec2(objectIndexCoords.x*4+1, objectIndexCoords.y), 0), texelFetch (uTexturePerObjectMatrix, ivec2(objectIndexCoords.x*4+2, objectIndexCoords.y), 0), texelFetch (uTexturePerObjectMatrix, ivec2(objectIndexCoords.x*4+3, objectIndexCoords.y), 0));")
        src.push("mat4 objectDecodeAndInstanceMatrix = objectInstanceMatrix * mat4 (texelFetch (uObjectPerObjectPositionsDecodeMatrix, ivec2(objectIndexCoords.x*4+0, objectIndexCoords.y), 0), texelFetch (uObjectPerObjectPositionsDecodeMatrix, ivec2(objectIndexCoords.x*4+1, objectIndexCoords.y), 0), texelFetch (uObjectPerObjectPositionsDecodeMatrix, ivec2(objectIndexCoords.x*4+2, objectIndexCoords.y), 0), texelFetch (uObjectPerObjectPositionsDecodeMatrix, ivec2(objectIndexCoords.x*4+3, objectIndexCoords.y), 0));")

        src.push("uint solid = texelFetch (uObjectPerObjectColorsAndFlags, ivec2(objectIndexCoords.x*8+7, objectIndexCoords.y), 0).r;");

        // get position
        src.push("positions[0] = vec3(texelFetch(uTexturePerVertexIdCoordinates, ivec2(indexPositionH.r, indexPositionV.r), 0));")
        src.push("positions[1] = vec3(texelFetch(uTexturePerVertexIdCoordinates, ivec2(indexPositionH.g, indexPositionV.g), 0));")
        src.push("positions[2] = vec3(texelFetch(uTexturePerVertexIdCoordinates, ivec2(indexPositionH.b, indexPositionV.b), 0));")

        // get color
        src.push("uvec4 color = texelFetch (uObjectPerObjectColorsAndFlags, ivec2(objectIndexCoords.x*8+0, objectIndexCoords.y), 0);");

        src.push(`if (color.a == 0u) {`);
        src.push("   gl_Position = vec4(3.0, 3.0, 3.0, 1.0);"); // Cull vertex
        src.push("   return;");
        src.push("};");

        // get normal
        src.push("vec3 normal = normalize(cross(positions[2] - positions[0], positions[1] - positions[0]));");

        src.push("vec3 position;");
        src.push("position = positions[gl_VertexID % 3];");

        src.push("vec3 viewNormal = -normalize((transpose(inverse(viewMatrix*objectDecodeAndInstanceMatrix)) * vec4(normal,1)).xyz);");

        // when the geometry is not solid, if needed, flip the triangle winding
        src.push("if (solid != 1u) {");
        src.push("if (isPerspectiveMatrix(projMatrix)) {");
        src.push("vec3 uCameraEyeRtcInQuantizedSpace = (inverse(sceneModelMatrix * objectDecodeAndInstanceMatrix) * vec4(uCameraEyeRtc, 1)).xyz;")
        src.push("if (dot(position.xyz - uCameraEyeRtcInQuantizedSpace, normal) < 0.0) {");
        src.push("position = positions[2 - (gl_VertexID % 3)];");
        src.push("viewNormal = -viewNormal;");
        src.push("}");
        src.push("} else {");
        src.push("if (viewNormal.z < 0.0) {");
        src.push("position = positions[2 - (gl_VertexID % 3)];");
        src.push("viewNormal = -viewNormal;");
        src.push("}");
        src.push("}");
        src.push("}");

         src.push("vec4 worldPosition = sceneModelMatrix * (objectDecodeAndInstanceMatrix * vec4(position, 1.0)); ");
        src.push("vec4 viewPosition = viewMatrix * worldPosition; ");

        src.push("vec4 clipPos = projMatrix * viewPosition;");
        if (scene.logarithmicDepthBufferEnabled) {
            src.push("vFragDepth = 1.0 + clipPos.w;");
            src.push("isPerspective = float (isPerspectiveMatrix(projMatrix));");
        }
        if (clipping) {
            src.push("vWorldPosition = worldPosition;");
            src.push("vFlags2 = flags2.r;");
        }
        src.push("gl_Position = clipPos;");
        src.push("vHighPrecisionZW = gl_Position.zw;");
        src.push("}");

        src.push("}");

        return src;
    }

    _buildFragmentShader() {
        const scene = this._scene;
        const sectionPlanesState = scene._sectionPlanesState;
        const clipping = sectionPlanesState.sectionPlanes.length > 0;
        const src = [];
        src.push('#version 300 es');
        src.push("// Triangles dataTexture draw fragment shader");
        src.push("#ifdef GL_FRAGMENT_PRECISION_HIGH");
        src.push("precision highp float;");
        src.push("precision highp int;");
        src.push("#else");
        src.push("precision mediump float;");
        src.push("precision mediump int;");
        src.push("#endif");

        src.push("in highp vec2 vHighPrecisionZW;");
        src.push("out vec4 outColor;");

        if (scene.logarithmicDepthBufferEnabled) {
            src.push("in float isPerspective;");
            src.push("uniform float logDepthBufFC;");
            src.push("in float vFragDepth;");
        }
        if (clipping) {
            src.push("in vec4 vWorldPosition;");
            src.push("flat in uint vFlags2;");
            for (let i = 0, len = sectionPlanesState.sectionPlanes.length; i < len; i++) {
                src.push("uniform bool sectionPlaneActive" + i + ";");
                src.push("uniform vec3 sectionPlanePos" + i + ";");
                src.push("uniform vec3 sectionPlaneDir" + i + ";");
            }
        }
        src.push("void main(void) {");

        if (clipping) {
            src.push("  bool clippable = vFlags2 > 0u;");
            src.push("  if (clippable) {");
            src.push("  float dist = 0.0;");
            for (let i = 0, len = sectionPlanesState.sectionPlanes.length; i < len; i++) {
                src.push("if (sectionPlaneActive" + i + ") {");
                src.push("   dist += clamp(dot(-sectionPlaneDir" + i + ".xyz, vWorldPosition.xyz - sectionPlanePos" + i + ".xyz), 0.0, 1000.0);");
                src.push("}");
            }
            src.push("  if (dist > 0.0) { ");
            src.push("      discard;")
            src.push("  }");
            src.push("}");
        }

        if (scene.logarithmicDepthBufferEnabled) {
             src.push("    gl_FragDepth = isPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;");
            //src.push("    gl_FragDepth = log2( vFragDepth ) * logDepthBufFC * 0.5;");
        }
        src.push("float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;");
        src.push("    outColor = vec4(vec3(1.0 - fragCoordZ), 1.0); ");
        src.push("}");
        return src;
    }

    webglContextRestored() {
        this._program = null;
    }

    destroy() {
        if (this._program) {
            this._program.destroy();
        }
        this._program = null;
    }
}

