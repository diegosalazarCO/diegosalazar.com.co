---
title: "Where does Core ML run your model?"
date: 2026-10-31
categories: ["ios", "ai", "interactive"]
tags: ["coreml", "neural-engine", "apple-silicon", "gpu", "three.js"]
heroImage: "../../assets/blog/coreml-compute-units/preview.jpg"
layout: fullscreen
scene: coreml-dispatch
---

An interactive, full-screen look at how Core ML spreads a neural network across the CPU, GPU and Neural Engine of an Apple-silicon-style SoC.

Pick a compute-unit setting (`.all`, `.cpuAndGPU`, `.cpuAndNeuralEngine`) and watch the same model re-route: tokens leave unified memory, cross the fabric and execute on a systolic MAC array, a field of SIMD lanes or a cluster of CPU cores. Tap an operation in the graph to break it (an unaligned tensor, or an op no accelerator supports) and see the stall, the SRAM flush, the hop between units, and what it does to latency and efficiency. Lift the heat spreader for an X-ray of the die, or jump between camera presets.

This is an illustrative floor plan, not a die shot: block counts follow a base Apple-silicon layout, the Neural Engine's internals are not public (the systolic array is a model of how such accelerators work) and every number is simulated, in the right order of magnitude.

Drag to orbit, scroll or pinch to zoom, double-tap to recenter. Press ▶ for a guided story.
