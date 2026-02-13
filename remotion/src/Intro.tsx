/**
 * Short intro/title card composition — no session data required.
 * Use for "create a video" or as a standalone clip.
 */

import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";

export type IntroProps = {
  title?: string;
  subtitle?: string;
};

const defaultIntroProps: IntroProps = {
  title: "AL",
  subtitle: "Agent sessions, visualized.",
};

export const defaultIntroPropsExport = defaultIntroProps;

export const Intro: React.FC<IntroProps> = ({
  title = defaultIntroProps.title,
  subtitle = defaultIntroProps.subtitle,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scale = interpolate(frame, [0, fps * 0.8], [0.92, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const subtitleOpacity = interpolate(frame, [fps * 0.5, fps * 1.2], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "linear-gradient(135deg, #0f0f12 0%, #1a1a24 50%, #0d0d10 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          opacity: fadeIn,
          transform: `scale(${scale})`,
          textAlign: "center",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 72,
            fontWeight: 700,
            color: "#fff",
            letterSpacing: "-0.02em",
          }}
        >
          {title}
        </h1>
        <p
          style={{
            margin: "16px 0 0",
            fontSize: 22,
            color: "rgba(255,255,255,0.7)",
            opacity: subtitleOpacity,
            fontWeight: 400,
          }}
        >
          {subtitle}
        </p>
      </div>
    </div>
  );
};
