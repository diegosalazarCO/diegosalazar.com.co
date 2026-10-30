---
title: "How ARC works, from a RAM cell to a retain cycle"
date: 2026-10-30
categories: ["ios", "technology", "interactive"]
tags: ["swift", "arc", "memory", "clean-architecture", "three.js"]
heroImage: "../../assets/blog/how-arc-works/preview.jpg"
layout: fullscreen
scene: arc-memory
---

An interactive, full-screen walkthrough of how Swift manages memory, drawn on real-looking hardware.

**01 · Hardware.** A DDR module lies on a board, its chips printed with addressed memory cells. Allocate an object and watch a data packet cross the memory bus, light up a cell and raise the object above it. Then add strong, weak and unowned references, release them one by one, and see what the retain count, the side table and a dangling pointer actually do.

**02 · Architecture.** The same rules at app scale. Log in to build a Dashboard (ViewController → ViewModel → Interactor), log out, and find out why a strong back-reference leaves two objects alive forever. Flip the switch to make it weak and watch the whole screen unwind.

Drag to orbit, scroll or pinch to zoom, double-tap to recenter. Press ▶ to let it tell the story by itself, or the eye icon for a clean, uncluttered view.
