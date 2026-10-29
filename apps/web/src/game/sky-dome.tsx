import '@tanstack/react-start/client-only';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { BackSide, Color, type Mesh, ShaderMaterial, Vector3 } from 'three';

import { hazeColor } from './tuning.ts';

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform vec3 uSunColor;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec3 uSunDir;
uniform float uTime;
varying vec3 vDir;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 turn = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = turn * p;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec3 dir = normalize(vDir);
  float up = max(dir.y, 0.0);
  float toSun = max(dot(dir, uSunDir), 0.0);

  vec3 sky = mix(uHorizon, uZenith, pow(up, 0.5));
  sky += uSunColor * (pow(toSun, 5.0) * 0.18 + pow(toSun, 48.0) * 0.45);

  // Clouds on a flat layer overhead, so they crowd and thin toward the
  // horizon the way a real deck does.
  vec2 deck = dir.xz / (up + 0.1) * 0.55;
  vec2 wind = vec2(0.012, 0.005) * uTime;
  float billow = fbm(deck + wind);
  float detail = fbm(deck * 2.3 - wind * 1.7 + 7.3);
  float cover = smoothstep(0.5, 0.78, billow * 0.72 + detail * 0.28);
  // Thinner toward the sun means that edge faces it and catches the light.
  float sunward = fbm(deck + wind + uSunDir.xz * 0.06);
  float lit = clamp(0.55 + (billow - sunward) * 4.0, 0.0, 1.0);
  vec3 cloud = mix(uCloudShade, uCloudLit, lit) + uSunColor * pow(toSun, 6.0) * 0.5;
  // Wispy cirrus streaks above the deck.
  float cirrus = smoothstep(0.55, 0.85, fbm(vec2(deck.x * 0.35, deck.y * 2.5) + wind * 0.4 + 3.1));
  float overhead = smoothstep(0.03, 0.3, dir.y);
  sky = mix(sky, uCloudLit, cirrus * overhead * 0.35);
  sky = mix(sky, cloud, cover * overhead * 0.92);

  float disc = smoothstep(0.9994, 0.9997, toSun);
  sky += uSunColor * disc * 6.0 * (1.0 - cover * overhead);

  gl_FragColor = vec4(sky, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // Mixed in after the output transform, as three mixes fog, so the haze
  // matches fogged terrain exactly.
  float haze = 1.0 - smoothstep(-0.02, 0.22, dir.y);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, haze);
}
`;

const passThrough = () => undefined;

// A camera-centred dome: a deep blue gradient, the sun's glow, and two
// drifting cloud layers, all in one draw call drawn behind everything.
export const SkyDome = ({
  sun,
}: {
  readonly sun: readonly [number, number, number];
}) => {
  const dome = useRef<Mesh>(null);
  const [x, y, z] = sun;
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        side: BackSide,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uZenith: { value: new Color('#2f6fd0') },
          uHorizon: { value: new Color('#a9cdf0') },
          uHaze: { value: new Color(hazeColor) },
          uSunColor: { value: new Color('#ffdca8') },
          uCloudLit: { value: new Color('#ffffff') },
          uCloudShade: { value: new Color('#8d9ab0') },
          uSunDir: { value: new Vector3(x, y, z).normalize() },
          uTime: { value: 0 },
        },
      }),
    [x, y, z],
  );
  useFrame(({ camera, clock }) => {
    const mesh = dome.current;
    if (!mesh) return;
    mesh.position.copy(camera.position);
    const time =
      mesh.material instanceof ShaderMaterial
        ? mesh.material.uniforms.uTime
        : undefined;
    if (time) time.value = clock.elapsedTime;
  });
  return (
    <mesh
      ref={dome}
      material={material}
      renderOrder={-1}
      frustumCulled={false}
      raycast={passThrough}
    >
      <sphereGeometry args={[1500, 32, 16]} />
    </mesh>
  );
};
