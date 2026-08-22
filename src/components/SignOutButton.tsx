"use client";

import { Icon } from "./Icon";

/**
 * Sign out, on every screen.
 *
 * It existed on exactly one — the profile editor — so signing out meant knowing
 * to go there first. On a shared or borrowed computer that is not a
 * convenience problem: someone who cannot find the exit leaves the session
 * open, and the next person at that machine is signed in as them, with their
 * applications, their messages and their salary expectations.
 *
 * A client component so it can be dropped into server pages and client pages
 * alike without either having to care.
 */
export default function SignOutButton({ className = "iconbtn" }: { className?: string }) {
  return (
    <button
      className={className}
      title="Sign out"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        // Full navigation rather than a router push: signing out must drop every
        // piece of client state, and a soft navigation keeps it.
        window.location.href = "/";
      }}
    >
      <Icon name="power" size={15} label="Sign out" />
    </button>
  );
}
