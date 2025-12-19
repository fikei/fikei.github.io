"use client"

import { useRef, useMemo } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"

// Custom shader material for advanced effects
const vertexShader = `
  uniform float time;
  uniform float intensity;
  varying vec2 vUv;
  varying vec3 vPosition;

  void main() {
    vUv = uv;
    vPosition = position;

    vec3 pos = position;

    // More pronounced wave effects
    pos.z += sin(pos.x * 3.0 + time) * 0.3 * intensity;
    pos.z += cos(pos.y * 2.5 + time * 0.7) * 0.25 * intensity;
    pos.y += sin(pos.x * 5.0 + time * 0.5) * 0.15 * intensity;
    pos.x += cos(pos.y * 4.0 + time * 0.8) * 0.1 * intensity;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`

const fragmentShader = `
  uniform float time;
  uniform float intensity;
  uniform vec3 color1;
  uniform vec3 color2;
  varying vec2 vUv;
  varying vec3 vPosition;

  void main() {
    vec2 uv = vUv;

    // Create animated noise pattern with more variation
    float noise = sin(uv.x * 8.0 + time) * cos(uv.y * 6.0 + time * 0.8);
    noise += sin(uv.x * 12.0 - time * 1.5) * cos(uv.y * 10.0 + time * 1.2) * 0.5;
    noise += sin(uv.x * 4.0 + time * 0.5) * 0.3;

    // Add flowing patterns
    float flow = sin(uv.x * 3.0 + uv.y * 3.0 + time * 0.5) * 0.5;
    noise += flow;

    // Normalize noise
    noise = noise * 0.5 + 0.5;

    // Mix colors based on noise
    vec3 color = mix(color1, color2, noise);

    // Add subtle shimmer
    float shimmer = sin(time * 2.0 + noise * 10.0) * 0.1 + 0.9;
    color *= shimmer;

    // Vignette/glow effect
    float dist = length(uv - 0.5);
    float glow = 1.0 - dist * 0.8;
    glow = pow(glow, 1.5);

    // Final opacity with more visibility
    float alpha = glow * 0.95;

    gl_FragColor = vec4(color, alpha);
  }
`

export function ShaderPlane({
  position,
  color1 = "#ff5722",
  color2 = "#ffffff",
}: {
  position: [number, number, number]
  color1?: string
  color2?: string
}) {
  const mesh = useRef<THREE.Mesh>(null)

  const uniforms = useMemo(
    () => ({
      time: { value: 0 },
      intensity: { value: 1.0 },
      color1: { value: new THREE.Color(color1) },
      color2: { value: new THREE.Color(color2) },
    }),
    [color1, color2],
  )

  useFrame((state) => {
    if (mesh.current) {
      uniforms.time.value = state.clock.elapsedTime * 0.5
      uniforms.intensity.value = 0.8 + Math.sin(state.clock.elapsedTime * 1.5) * 0.4

      // Subtle rotation
      mesh.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.2) * 0.1
    }
  })

  return (
    <mesh ref={mesh} position={position}>
      <planeGeometry args={[4, 4, 64, 64]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}

export function EnergyRing({
  radius = 1,
  position = [0, 0, 0],
}: {
  radius?: number
  position?: [number, number, number]
}) {
  const mesh = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    if (mesh.current) {
      mesh.current.rotation.z = state.clock.elapsedTime
      const material = mesh.current.material as THREE.MeshBasicMaterial
      material.opacity = 0.5 + Math.sin(state.clock.elapsedTime * 3) * 0.3
    }
  })

  return (
    <mesh ref={mesh} position={position}>
      <ringGeometry args={[radius * 0.8, radius, 32]} />
      <meshBasicMaterial color="#ff5722" transparent opacity={0.6} side={THREE.DoubleSide} />
    </mesh>
  )
}
