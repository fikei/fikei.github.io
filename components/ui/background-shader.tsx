"use client"

import { Canvas } from "@react-three/fiber"
import { ShaderPlane } from "./background-paper-shaders"
import { Suspense } from "react"

export function BackgroundShader() {
  return (
    <div className="fixed inset-0 -z-10">
      <Canvas
        camera={{ position: [0, 0, 5], fov: 75 }}
        style={{ background: "#fafafa" }}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.5} />
          <ShaderPlane
            position={[0, 0, 0]}
            color1="#e0e0e0"
            color2="#fafafa"
          />
          <ShaderPlane
            position={[1.5, 1, -1]}
            color1="#f5f5f5"
            color2="#ffffff"
          />
          <ShaderPlane
            position={[-1.5, -1, -1]}
            color1="#eeeeee"
            color2="#fafafa"
          />
        </Suspense>
      </Canvas>
    </div>
  )
}
