// Thin React wrapper around LashTryOnController. This is the only place in
// the engine package that touches React, and it only imports from the
// engine's own public surface ("../index") — never from app code. The app
// talks to the engine exclusively through this component's props and the
// imperative handle it exposes.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  createLashTryOnController,
  type LashTryOnController,
  type LashDebugController,
} from "../index";

type FullController = LashTryOnController & LashDebugController;

export type LashTryOnStatus = "loading" | "ready" | "error";

export type LashTryOnProps = {
  styleId: string;
  intensity: number;
  comparing?: boolean;
  debug?: boolean;
  className?: string;
  onStatus?: (status: LashTryOnStatus) => void;
  onError?: (error: unknown) => void;
  onFaceFound?: () => void;
  onFaceLost?: () => void;
  onLowLight?: () => void;
  onFpsDrop?: () => void;
};

export type LashTryOnHandle = {
  capture: () => Promise<Blob>;
  controller: FullController | null;
};

export const LashTryOn = forwardRef<LashTryOnHandle, LashTryOnProps>(function LashTryOn(
  {
    styleId,
    intensity,
    comparing = false,
    debug = false,
    className,
    onStatus,
    onError,
    onFaceFound,
    onFaceLost,
    onLowLight,
    onFpsDrop,
  },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<FullController | null>(null);
  const [status, setStatus] = useState<LashTryOnStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    const controller = createLashTryOnController({ initialStyleId: styleId });
    controllerRef.current = controller;

    if (onFaceFound) controller.on("faceFound", onFaceFound);
    if (onFaceLost) controller.on("faceLost", onFaceLost);
    if (onLowLight) controller.on("lowLight", onLowLight);
    if (onFpsDrop) controller.on("fpsDrop", onFpsDrop);

    (async () => {
      try {
        if (!videoRef.current || !overlayRef.current) return;
        await controller.attach(videoRef.current, overlayRef.current);
        if (cancelled) return;
        controller.setIntensity(intensity);
        controller.setComparing(comparing);
        controller.setDebug(debug);
        setStatus("ready");
        onStatus?.("ready");
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        onStatus?.("error");
        onError?.(err);
      }
    })();

    return () => {
      cancelled = true;
      controller.destroy();
      controllerRef.current = null;
    };
    // Intentionally mount-once: style/intensity/comparing/debug are synced
    // via the effects below rather than tearing down the camera/tracker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    controllerRef.current?.setStyle(styleId);
  }, [styleId]);

  useEffect(() => {
    controllerRef.current?.setIntensity(intensity);
  }, [intensity]);

  useEffect(() => {
    controllerRef.current?.setComparing(comparing);
  }, [comparing]);

  useEffect(() => {
    controllerRef.current?.setDebug(debug);
  }, [debug]);

  useImperativeHandle(
    ref,
    () => ({
      capture: () => {
        const controller = controllerRef.current;
        if (!controller) return Promise.reject(new Error("LashTryOn: not attached yet"));
        return controller.capture();
      },
      get controller() {
        return controllerRef.current;
      },
    }),
    [],
  );

  return (
    <div
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}
    >
      <video
        ref={videoRef}
        playsInline
        muted
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
      <canvas
        ref={overlayRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
      {status === "loading" && <div data-lash-status="loading" />}
    </div>
  );
});
