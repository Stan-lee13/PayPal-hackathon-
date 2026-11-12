"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SITE } from "@/lib/site-map";

/** The whole site in one sheet. On a phone this is the navigation; on a wide screen it is the "everything" behind the short row of links. */
export function SiteMenu() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button ref={button} type="button" className="btn btn-quiet btn-sm !text-[.84rem]" aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((o) => !o)} data-testid="menu-button">
        <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true"><path d={open ? "M2 1 L14 11 M14 1 L2 11" : "M1 1 H15 M1 6 H15 M1 11 H15"} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" /></svg>
        {open ? "Close" : "Menu"}
      </button>
      {open ? (
        <div id="site-menu" className="site-menu" data-testid="site-menu">
          <nav aria-label="All pages" className="mx-auto grid max-w-6xl gap-x-10 gap-y-7 px-5 py-7 sm:grid-cols-2 lg:grid-cols-4">
            {SITE.map((g) => (
              <div key={g.group}>
                <p className="label">{g.group}</p>
                <ul className="mt-2 border-t-[1.5px] border-ink">
                  {g.places.map((p) => (
                    <li key={p.href} className="border-b border-rule">
                      <Link href={p.href} className="block py-2.5" aria-current={path === p.href ? "page" : undefined} onClick={() => { setOpen(false); if (p.href.includes("tour=1")) window.dispatchEvent(new Event("envelope:tour")); }}>
                        <span className="title text-[1.08rem]">{p.name}</span>
                        <span className="mt-0.5 block text-[.82rem] text-ink-2">{p.does}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      ) : null}
    </>
  );
}
