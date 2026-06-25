import { useRef, useEffect } from "react";

export default function ClickSpark({ children }) {
  const canvasRef = useRef(null);
  const sparks = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas.parentElement;

    const resize = () => {
      const rect = parent.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    let raf;

    const draw = (t) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      sparks.current = sparks.current.filter((s) => {
        const p = (t - s.start) / 600;
        if (p > 1) return false;

        const dist = p * 40;
        const fade = 1 - p;

        ctx.strokeStyle = `rgba(255,255,255,${fade})`;
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(
          s.x + Math.cos(s.angle) * dist,
          s.y + Math.sin(s.angle) * dist
        );
        ctx.stroke();

        return true;
      });

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleClick = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const now = performance.now();

    sparks.current.push(
      ...Array.from({ length: 10 }).map((_, i) => ({
        x,
        y,
        angle: (Math.PI * 2 * i) / 10,
        start: now
      }))
    );
  };

  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      {/* CLICK LAYER */}
      <div
        onClick={handleClick}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1
        }}
      />

      {/* CANVAS */}
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 2,
          pointerEvents: "none"
        }}
      />

      {/* YOUR CONTENT */}
      <div style={{ position: "relative", zIndex: 3 }}>
        {children}
      </div>
    </div>
  );
}