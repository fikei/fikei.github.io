"use client"

import { Canvas } from "@react-three/fiber"
import { ShaderPlane } from "./background-paper-shaders"
import { Suspense } from "react"

export function BackgroundShader() {
  return (
    <div className="fixed inset-0 -z-10 w-full h-full">
      <Canvas
        camera={{ position: [0, 0, 5], fov: 75 }}
        style={{
          width: '100%',
          height: '100%',
          background: '#fafafa'
        }}
        gl={{
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance'
        }}
      >
        <Suspense fallback={null}>
          {/* Main center shader plane */}
          <ShaderPlane
            position={[0, 0, 0]}
            color1="#d0d0d0"
            color2="#f0f0f0"
          />

          {/* Top right accent */}
          <ShaderPlane
            position={[2, 1.5, -1]}
            color1="#c5c5c5"
            color2="#e8e8e8"
          />

          {/* Bottom left accent */}
          <ShaderPlane
            position={[-2, -1.5, -1]}
            color1="#dadada"
            color2="#f5f5f5"
          />

          {/* Far background layer */}
          <ShaderPlane
            position={[0, 0, -2]}
            color1="#e5e5e5"
            color2="#f8f8f8"
          />
        </Suspense>
      </Canvas>
    </div>
  )
}
