"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [phase, setPhase] = useState<"start" | "grow" | "out">("start");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("grow"), 100);
    const t2 = setTimeout(() => setPhase("out"), 2300);
    const t3 = setTimeout(() => router.replace("/admin-overview"), 2900);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [router]);

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; overflow: hidden; }
        body {
          background: #00BCD4;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
        }
        @import url('https://fonts.googleapis.com/css2?family=Nunito:ital,wght@0,900;1,900&display=swap');
        @keyframes fadeOut {
          from { opacity: 1; }
          to   { opacity: 0; }
        }
        .fading { animation: fadeOut 0.6s ease forwards; }
        @keyframes dotPulse {
          0%,100% { transform: scale(1);   opacity: 0.5; }
          50%     { transform: scale(1.6); opacity: 1; }
        }
        .dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: rgba(255,255,255,0.9);
          animation: dotPulse 1.1s ease-in-out infinite;
        }
        .dot2 { animation-delay: 0.2s; }
        .dot3 { animation-delay: 0.4s; }
      `}</style>

      <div className={phase === "out" ? "fading" : ""}
        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>

        {/* brand name — grows from small to big */}
        <div style={{
          display: "flex",
          alignItems: "baseline",
          gap: 0,
          transform: phase === "start" ? "scale(0.25)" : "scale(1)",
          opacity: phase === "start" ? 0 : 1,
          transition: "transform 1.1s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.6s ease",
          transformOrigin: "center center",
        }}>
          {/* Cleen — dark navy italic */}
          <span style={{
            fontSize: 64,
            fontWeight: 900,
            fontStyle: "italic",
            color: "#0D2D5E",
            fontFamily: "'Nunito', 'Arial Black', system-ui, sans-serif",
            letterSpacing: "-1px",
            lineHeight: 1,
          }}>
            Cleen
          </span>

          {/* zo — white italic */}
          <span style={{
            fontSize: 64,
            fontWeight: 900,
            fontStyle: "italic",
            color: "#ffffff",
            fontFamily: "'Nunito', 'Arial Black', system-ui, sans-serif",
            letterSpacing: "-1px",
            lineHeight: 1,
            position: "relative",
          }}>
            zo
            {/* sparkle star */}
            <span style={{
              position: "absolute",
              top: -8,
              right: -18,
              fontSize: 22,
              color: "#ffffff",
              fontStyle: "normal",
              lineHeight: 1,
            }}>✦</span>
          </span>
        </div>

        {/* tagline */}
        <div style={{
          fontSize: 12,
          color: "rgba(22, 42, 109, 0.8)",
          fontWeight: 600,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          fontFamily: "system-ui, sans-serif",
          opacity: phase === "start" ? 0 : 1,
          transition: "opacity 0.8s ease 0.7s",
        }}>
          Clean Home. Happy You
        </div>

        {/* loading dots */}
        <div style={{
          display: "flex", gap: 7,
          opacity: phase === "start" ? 0 : 1,
          transition: "opacity 0.6s ease 1s",
        }}>
          <div className="dot" />
          <div className="dot dot2" />
          <div className="dot dot3" />
        </div>
      </div>
    </>
  );
}