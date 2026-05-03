# VALOR-Client

VALOR-Client is a high-performance, self-hosted streaming desktop client designed for a premium media experience. Built with Electron and Vite, it leverages the power of mpv for seamless playback and integrates deeply with Jellyfin and TMDB to provide a polished, feature-rich interface for your media library.

## Recent Activity

* Enhanced mpv playback stability, including fixes for startup race conditions, instant-close diagnostics, and hardware acceleration for HDR/DV.
* Introduced a dedicated TV Mode with a refactored UI, featuring player controls, detail pages, and a specialized desktop TV interface.
* Improved Jellyfin and TMDB integration, including better episode picking, subtitle search optimizations, and robust metadata lookup.
* Implemented a modular popup system and enhanced the auto-updater with self-healing capabilities for more reliable updates.
* Refined playback features such as "watched-episodes" tracking, auto-refreshing "Continue Watching" lists, and improved audio backfill.

## Features

* **mpv-Powered Playback:** High-performance video rendering with support for HDR and Dolby Vision via GPU/D3D11.
* **Jellyfin & TMDB Integration:** Seamlessly browse your Jellyfin library with enriched metadata and episode information from TMDB.
* **Dedicated TV Mode:** A specialized UI mode optimized for large-screen desktop use, featuring a refactored component architecture and simplified navigation.
* **Advanced Subtitle Support:** Intelligent subtitle searching and management across different media types.
* **Robust Update System:** Automated self-healing updates designed to handle permission errors and ensure a seamless upgrade path.
* **Modern Tech Stack:** Built with Electron and Vite for a fast, responsive, and modern desktop experience.