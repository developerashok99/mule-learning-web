import type { APIRoute } from "astro";

const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      name: "Mule Learning Hub — MuleSoft course",
      short_name: "Mule Hub",
      description: "Lectures, summary podcasts and notes for the MuleSoft course",
      start_url: base,
      scope: base,
      id: base,
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#2f6f9f",
      icons: [
        { src: `${base}icons/icon-192.png`, sizes: "192x192", type: "image/png" },
        { src: `${base}icons/icon-512.png`, sizes: "512x512", type: "image/png" },
        { src: `${base}icons/maskable-192.png`, sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: `${base}icons/maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
        { src: `${base}icons/icon.svg`, sizes: "any", type: "image/svg+xml" },
      ],
    }),
    { headers: { "Content-Type": "application/manifest+json" } },
  );
