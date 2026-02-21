<div align="center">

# MakingLovart | Creative Whiteboard

A modern AI-powered infinite canvas designed for creative professionals.

[![Built with Nano Banana](https://img.shields.io/badge/Built%20with-Nano%20Banana-yellow?style=flat-square)](https://github.com/JimLiu/nanoBanana)
[![Inspired by Lovart](https://img.shields.io/badge/UI%20Inspired%20by-Lovart-ff69b4?style=flat-square)](https://lovart.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

</div>

---

## Project overview

MakingLovart is a web-based infinite canvas inspired by Lovart. It merges flexible drawing tools, a layered workspace and an organized inspiration library with AI-driven image/video generation (via Google Gemini) to accelerate creative workflows.

This repository is a learning project — feedback and contributions are welcome.

![MakingLovart preview](show.jpg)

## Highlights

- Lovart-inspired minimalist UI with collapsible panels and smooth transitions
- Organized inspiration library: Characters, Scenes, Props (drag-and-drop to canvas)
- Gemini-powered AI: text→image, image editing, inpainting, experimental video
- Full layer system: lock, hide, rename, reorder
- Multiple boards with local auto-save

## Quick start

Prerequisites: Node.js v16+ (recommended).

1) Clone and install

```bash
git clone https://github.com/your-username/MakingLovart.git
cd MakingLovart
npm install
```

2) (Optional) Configure Gemini API key

If you want AI features, add your key to an env file. Example env var used by the app:

```env
VITE_GEMINI_API_KEY=your_key_here
```

Copy `.env.example` to `.env.local` (Windows):

```bash
copy .env.example .env.local
```

Note: core whiteboard features work without an API key.

3) Run development server

```bash
npm run dev
```

Open http://localhost:5173

## Docker

Use Docker Compose to run in a container:

```bash
docker-compose up -d
```

Or use the Makefile:

```bash
make up
```

See `DOCKER_GUIDE.md` for deployment details and environment options.

## Tech stack

- React + TypeScript
- Vite
- Tailwind CSS
- Google Gemini (AI)
- localStorage for persistence

## Roadmap (selected)

- Real-time collaboration
- Cloud sync
- Multi-model AI support (Stable Diffusion, etc.)
- Plugin system and export improvements

## Contributing

Fork, create a branch, commit, push and open a PR. For details see `CONTRIBUTING.md`.

## Credits

- BananaPod — base project: https://github.com/ZHO-ZHO-ZHO/BananaPod
- Nano Banana — canvas engine: https://github.com/JimLiu/nanoBanana
- Lovart — UI inspiration: https://lovart.com/

---

<div align="center">

If this project helps you, please give it a ⭐️

[Report Bug](../../issues) · [Request Feature](../../issues)

</div>
