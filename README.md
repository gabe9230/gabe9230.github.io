# JavaScript to HAAS G-code Converter

A lightweight, browser-based tool for generating clean, customizable G-code for HAAS CNC machines using simple JavaScript functions. Designed for CNC students, programmers, and machinists who want fine control over their toolpaths without relying on bulky CAM software.

## Live Demo

[Try it now](https://gabe9230.github.io/G-Code%20Converter/)

## Features

- Script-based G-code generation (no install, no proprietary UI)
- Built-in tool library for defining end mills (more tools coming soon)
- Operations include face milling, contouring, threading, and plunge cuts
- Full control over feed rates, spindle speeds, coolant, depth steps, and more
- Outputs valid HAAS-compatible G-code ready for simulation or use
- Simple interface for editing and copying raw output

## Who It's For

- CNC students learning to write or debug G-code manually
- Programmers entering CNC workflows who want scriptable control
- Hobby machinists or shop-floor coders who dislike black-box CAM
- Anyone who wants to generate predictable, minimal G-code with full control

## Why I Built This

CAM software is powerful—but often overkill or too opaque. I wanted something between hand-written G-code and full CAM:  
- Transparent enough to teach and debug  
- Structured enough to reuse tool logic  
- Fast enough to generate production-ready paths with a script

Coming Soon
Support for drills, taps, and thread mills

Real-time G-code preview and visualizer

Error checking (depth bounds, safe retracts, etc.)

Optional postprocessors for other machines (e.g., Fanuc, GRBL)

Contributing
If you'd like to contribute, please read the Contributor License Agreement (CLA) first.

By contributing, you agree to:

Assign rights for merged code to the original author (Gabriel Halloran)

Waive any personal ownership claims over contributed code

Comply with the project’s non-commercial license

Bug reports, ideas, and feature suggestions are always welcome!

License
This software is licensed for personal, educational, and non-commercial use only.

Commercial redistribution, resale, or incorporation into proprietary products is prohibited without written permission.

See the LICENSE file for full terms.

Built and maintained by Gabriel Halloran — GitHub
