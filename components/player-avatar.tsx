"use client";

import { useState } from "react";

interface PlayerAvatarProps {
  name: string;
  headshotUrl?: string;
  size?: number;
}

function yahooPhotoUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const allowed = ["yahoo.com", "yimg.com"].some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
    return url.protocol === "https:" && allowed && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function PlayerAvatar({ name, headshotUrl, size = 32 }: PlayerAvatarProps) {
  const src = yahooPhotoUrl(headshotUrl);
  return <AvatarContent key={`${name}:${src ?? ""}`} name={name} src={src} size={size} />;
}

function AvatarContent({ name, src, size }: { name: string; src?: string; size: number }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return (
    <span className="player-avatar" style={{ width: size, height: size }} aria-hidden="true">
      <span>{initials}</span>
      {src && status !== "failed" ? (
        // Yahoo owns the image URL and HTTP cache; native lazy loading avoids a server proxy.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async"
          className={status === "loaded" ? "player-avatar-photo is-loaded" : "player-avatar-photo"}
          onLoad={() => setStatus("loaded")} onError={() => setStatus("failed")} />
      ) : null}
    </span>
  );
}
