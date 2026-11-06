import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';

export interface ConfettiCanvasRef {
  fire: (message?: string) => void;
}

interface Particle {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  vx: number;
  vy: number;
  angle: number;
  angularVelocity: number;
  tilt: number;
  tiltVelocity: number;
  opacity: number;
  shape: 'rect' | 'circle' | 'ribbon';
}

const CELEBRATION_COLORS = [
  '#f59e0b', // amber
  '#d97706', // warm amber / bronze
  '#b45309', // gold-brown
  '#fbbf24', // bright gold
  '#10b981', // emerald
  '#059669', // deep emerald
  '#f43f5e', // rose
  '#fb7185', // soft rose
  '#38bdf8', // sky blue
  '#6366f1', // soft indigo
  '#e2b49e', // peach parchment
];

export const ConfettiCanvas = forwardRef<ConfettiCanvasRef, object>((_props, ref) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const playCelebrationChime = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') ctx.resume();

      // Arpège mélodieux et doux : Do - Mi - Sol - Do (C5, E5, G5, C6)
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, i) => {
        const startTime = ctx.currentTime + i * 0.08;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = i === 3 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.exponentialRampToValueAtTime(0.08, startTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.6);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + 0.65);
      });
    } catch {
      // Ignorer si audio bloqué par politique navigateur
    }
  };

  const createBurst = (originX: number, originY: number, count: number, angleMin: number, angleMax: number) => {
    const newParticles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const angle = angleMin + Math.random() * (angleMax - angleMin);
      const speed = 7 + Math.random() * 14;
      const shapeType = Math.random() > 0.4 ? 'rect' : Math.random() > 0.5 ? 'circle' : 'ribbon';
      const size = 6 + Math.random() * 8;

      newParticles.push({
        x: originX,
        y: originY,
        w: size,
        h: shapeType === 'ribbon' ? size * 2.2 : size * (0.6 + Math.random() * 0.8),
        color: CELEBRATION_COLORS[Math.floor(Math.random() * CELEBRATION_COLORS.length)],
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        angle: Math.random() * Math.PI * 2,
        angularVelocity: (Math.random() - 0.5) * 0.25,
        tilt: Math.random() * Math.PI,
        tiltVelocity: 0.08 + Math.random() * 0.12,
        opacity: 1,
        shape: shapeType,
      });
    }
    return newParticles;
  };

  const fire = (message?: string) => {
    playCelebrationChime();

    if (message) {
      setToastMessage(message);
      if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = window.setTimeout(() => {
        setToastMessage(null);
      }, 4500);
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    // Double jet de confettis depuis les côtés gauche, droite et centre
    const burstLeft = createBurst(width * 0.15, height * 0.65, 55, -Math.PI * 0.45, -Math.PI * 0.15);
    const burstRight = createBurst(width * 0.85, height * 0.65, 55, -Math.PI * 0.85, -Math.PI * 0.55);
    const burstCenter = createBurst(width * 0.5, height * 0.45, 45, -Math.PI * 0.9, -Math.PI * 0.1);

    particlesRef.current = [...particlesRef.current, ...burstLeft, ...burstRight, ...burstCenter];

    if (!animationFrameRef.current) {
      animate();
    }
  };

  useImperativeHandle(ref, () => ({
    fire,
  }));

  const animate = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const particles = particlesRef.current;
    const gravity = 0.32;
    const drag = 0.985;

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];

      p.vx *= drag;
      p.vy = p.vy * drag + gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.angle += p.angularVelocity;
      p.tilt += p.tiltVelocity;

      // Début de fondu quand la particule descend
      if (p.y > canvas.height * 0.7) {
        p.opacity -= 0.015;
      }

      if (p.opacity <= 0 || p.y > canvas.height + 40) {
        particles.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.scale(Math.cos(p.tilt), 1);
      ctx.fillStyle = p.color;

      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'ribbon') {
        ctx.beginPath();
        ctx.roundRect(-p.w / 2, -p.h / 2, p.w, p.h, 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }

      ctx.restore();
    }

    if (particles.length > 0) {
      animationFrameRef.current = requestAnimationFrame(animate);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      animationFrameRef.current = null;
    }
  };

  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="fixed inset-0 pointer-events-none z-50 w-full h-full"
        style={{ pointerEvents: 'none' }}
      />
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-6 left-1/2 -translate-x-1/2 z-50 pointer-events-auto max-w-lg px-5 py-3 rounded-2xl parchment-sheet border-2 border-amber-600 shadow-2xl flex items-center gap-3 animate-bounce"
        >
          <span className="text-2xl">🎉</span>
          <div className="flex-1">
            <p className="font-serif font-bold text-amber-950 text-sm sm:text-base leading-snug">
              {toastMessage}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-amber-900 hover:text-amber-950 text-xs px-2 py-1 rounded bg-amber-900/10 hover:bg-amber-900/20 font-bold cursor-pointer transition"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
});

ConfettiCanvas.displayName = 'ConfettiCanvas';
