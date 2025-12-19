"use client"

import { BackgroundShader } from "@/components/ui/background-shader"
import { useState } from "react"

export default function Home() {
  const [activeFilter, setActiveFilter] = useState("all")

  const projects = [
    {
      id: 1,
      title: "Untitled AI Interface",
      status: "experimental",
      description: "A conversational interface that doesn't feel like talking to a chatbot.",
      spark: "Most AI interfaces feel mechanical. What if the interaction model prioritized clarity and context over speed?",
      built: "Built: Prototype exploring conversational UI patterns, context persistence, and interaction design for LLM-powered tools.",
    },
    {
      id: 2,
      title: "Personal Systems Framework",
      status: "live",
      description: "A minimal toolkit for building personal productivity systems that actually work.",
      spark: "Productivity tools are either too rigid or too open-ended. Can a system be opinionated but still flexible?",
      built: "Built: Modular framework combining note-taking primitives, task management patterns, and reflection protocols. Used daily.",
    },
    {
      id: 3,
      title: "Component Library (This Site)",
      status: "experimental",
      description: "Reusable design primitives and interaction patterns extracted from real projects.",
      spark: "Every project reinvents the same patterns. What if the site itself was the component library?",
      built: "Built: Living library of typography systems, layout primitives, and micro-interactions. This page uses them.",
    },
    {
      id: 4,
      title: "Behavioral Data Studio",
      status: "paused",
      description: "A tool for exploring patterns in personal behavior data.",
      spark: "We generate behavioral data constantly. What patterns emerge when you can actually explore it?",
      built: "Built: Early prototype for visualizing habit patterns, decision trees, and temporal behaviors. On hold while exploring different data models.",
    },
    {
      id: 5,
      title: "Your Project Here",
      status: "live",
      description: "Replace this with your actual project.",
      spark: "Edit the HTML to add your real projects, or remove this placeholder entirely.",
      built: "Built: Placeholder to demonstrate the project card structure and filtering system.",
      isPlaceholder: true,
    },
  ]

  const filteredProjects = activeFilter === "all"
    ? projects
    : projects.filter(p => p.status === activeFilter)

  const getStatusStyles = (status: string) => {
    const styles = {
      live: "text-[#0f7d4f] bg-[#0f7d4f]/10",
      experimental: "text-[#8b5cf6] bg-[#8b5cf6]/10",
      paused: "text-[#999999] bg-[#999999]/10",
      archived: "text-[#d4d4d4] bg-[#d4d4d4]/10",
    }
    return styles[status as keyof typeof styles] || styles.experimental
  }

  return (
    <>
      <BackgroundShader />
      <main className="relative z-10 min-h-screen">
        <div className="max-w-[900px] mx-auto px-4 md:px-8 py-8 md:py-16">
          {/* Hero */}
          <section className="mb-24 pb-16 border-b border-border">
            <h1 className="text-[1.75rem] md:text-[2.25rem] leading-[1.4] md:leading-[1.3] font-normal mb-6 max-w-[800px]">
              Cambio is an AI product studio for building things that don&apos;t exist yet.
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-[700px] leading-relaxed">
              A personal playground for shipping tools, systems, and experiments, end-to-end.
            </p>
            <p className="text-[0.9375rem] text-muted-foreground/60 italic">
              This site is a working surface, not a case study archive.
            </p>
          </section>

          {/* What Is Cambio */}
          <section className="mb-24">
            <h2 className="text-[0.875rem] font-medium uppercase tracking-wide text-muted-foreground mb-10">
              What Is Cambio
            </h2>
            <div className="text-[1.0625rem] leading-[1.8] space-y-6">
              <p>
                Cambio is not a company in the traditional sense.<br />
                It&apos;s a container for focused curiosity.
              </p>

              <p>It exists to explore ideas through making:</p>

              <ul className="space-y-2 my-6">
                <li className="pl-6 relative before:content-['—'] before:absolute before:left-0 before:text-muted-foreground/60">
                  Small, opinionated tools
                </li>
                <li className="pl-6 relative before:content-['—'] before:absolute before:left-0 before:text-muted-foreground/60">
                  Experimental interfaces
                </li>
                <li className="pl-6 relative before:content-['—'] before:absolute before:left-0 before:text-muted-foreground/60">
                  Systems that connect design, data, and human behavior
                </li>
              </ul>

              <p>
                There are no clients.<br />
                No roadmaps shaped by consensus.<br />
                No obligation to scale.
              </p>

              <p>Each project starts with a question and ends wherever the learning stops being interesting.</p>

              <p>Ownership is full-stack by default, from concept to code to consequences.</p>
            </div>
          </section>

          {/* Projects */}
          <section className="mb-24">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-6">
              <h2 className="text-[0.875rem] font-medium uppercase tracking-wide text-muted-foreground">
                Projects
              </h2>
              <div className="flex gap-2 flex-wrap">
                {["all", "live", "experimental", "paused"].map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setActiveFilter(filter)}
                    className={`text-[0.8125rem] px-4 py-2 border rounded transition-all ${
                      activeFilter === filter
                        ? "bg-foreground text-background border-foreground"
                        : "bg-transparent text-muted-foreground border-border hover:border-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {filter.charAt(0).toUpperCase() + filter.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8 md:gap-16">
              {filteredProjects.map((project) => (
                <article
                  key={project.id}
                  className={`border-t border-border pt-6 transition-all hover:translate-x-1 ${
                    project.isPlaceholder ? "opacity-50" : ""
                  }`}
                >
                  <div className="flex justify-between items-start mb-4 gap-4">
                    <h3 className="text-lg font-medium leading-snug">{project.title}</h3>
                    <span
                      className={`text-[0.75rem] uppercase tracking-wide px-2 py-1 rounded whitespace-nowrap font-medium ${getStatusStyles(
                        project.status
                      )}`}
                    >
                      {project.status}
                    </span>
                  </div>
                  <p className="text-[0.9375rem] font-medium mb-4">{project.description}</p>
                  <p className="text-sm text-muted-foreground italic mb-4">{project.spark}</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{project.built}</p>
                </article>
              ))}
            </div>
          </section>

          {/* How Cambio Works */}
          <section className="mb-24">
            <h2 className="text-[0.875rem] font-medium uppercase tracking-wide text-muted-foreground mb-10">
              How Cambio Works
            </h2>
            <div className="text-[1.0625rem] leading-[1.8] space-y-6">
              <p>Cambio runs on a few simple principles:</p>

              <div className="space-y-10 my-10">
                <div>
                  <h3 className="text-base font-semibold mb-2">Start small</h3>
                  <p className="text-muted-foreground">
                    Most ideas don&apos;t deserve a full product. They deserve a prototype that can be broken quickly.
                  </p>
                </div>

                <div>
                  <h3 className="text-base font-semibold mb-2">Build the real thing</h3>
                  <p className="text-muted-foreground">
                    No throwaway demos. If it&apos;s worth exploring, it&apos;s worth implementing properly.
                  </p>
                </div>

                <div>
                  <h3 className="text-base font-semibold mb-2">Favor systems over features</h3>
                  <p className="text-muted-foreground">
                    Reusable primitives, shared components, and patterns matter more than one-off wins.
                  </p>
                </div>

                <div>
                  <h3 className="text-base font-semibold mb-2">Let the work teach you</h3>
                  <p className="text-muted-foreground">
                    Projects are allowed to pause, mutate, or die. The point is clarity, not completion.
                  </p>
                </div>
              </div>

              <p className="text-muted-foreground/60 italic mt-6">
                Tooling appears only when it earns its place.<br />
                Complexity is treated as a cost, not a flex.
              </p>
            </div>
          </section>

          {/* About */}
          <section className="mb-24">
            <h2 className="text-[0.875rem] font-medium uppercase tracking-wide text-muted-foreground mb-10">
              About the Founder
            </h2>
            <div className="text-[1.0625rem] leading-[1.8] space-y-6">
              <p>Ian Fike is a product leader, designer, and builder with a systems mindset.</p>

              <p>
                He has worked across health tech, consumer platforms, and early-stage startups, often sitting at
                the intersection of product strategy and hands-on execution. His background blends design,
                engineering collaboration, and experimentation at scale.
              </p>

              <p>Cambio exists as a way to stay close to the work:</p>

              <ul className="space-y-2 my-6">
                <li className="pl-6 relative before:content-['—'] before:absolute before:left-0 before:text-muted-foreground/60">
                  Writing code
                </li>
                <li className="pl-6 relative before:content-['—'] before:absolute before:left-0 before:text-muted-foreground/60">
                  Designing interfaces
                </li>
                <li className="pl-6 relative before:content-['—'] before:absolute before:left-0 before:text-muted-foreground/60">
                  Testing ideas in the open
                </li>
              </ul>

              <p>Outside of software, Ian spends a lot of time outdoors and tends to think best while moving.</p>
            </div>
          </section>

          {/* Footer */}
          <footer className="mt-24 pt-16 border-t border-border text-muted-foreground text-[0.9375rem] space-y-4">
            <p>Cambio doesn&apos;t have a pitch deck.</p>
            <p>If something here resonates, you already know how to find the thread to pull.</p>
          </footer>
        </div>
      </main>
    </>
  )
}
