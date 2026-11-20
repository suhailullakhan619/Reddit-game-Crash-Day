import { Color, Vector3, type Material } from 'three';

// Global time + atmosphere values, written once per frame by <Atmosphere>, read by shaders.
export const fxTime = { value: 0 };

export const atmo = {
  horizon: new Color('#9fcbd6'),
  zenith: new Color('#4f8fb8'),
  sunDir: new Vector3(0.4, 0.8, 0.3).normalize(),
  sunColor: new Color('#fff1d6'),
  night: 0, // 0 day .. 1 full night
};

// Adds a cheap wind sway to an instanced Lambert material.
// Displacement grows with local vertex height so roots stay planted.
export function addWind(material: Material, amp: number, heightRef: number, key: string) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = fxTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
          #endif
          float h = clamp(position.y / ${heightRef.toFixed(2)}, 0.0, 1.0);
          float w = sin(uTime * 1.7 + ip.x * 0.31 + ip.z * 0.23) * 0.6 + sin(uTime * 3.1 + ip.z * 0.7) * 0.4;
          transformed.x += w * ${amp.toFixed(3)} * h * h;
          transformed.z += cos(uTime * 1.3 + ip.x * 0.4) * ${(amp * 0.6).toFixed(3)} * h * h;
        }`
      );
  };
  material.customProgramCacheKey = () => `wind-${key}`;
}
