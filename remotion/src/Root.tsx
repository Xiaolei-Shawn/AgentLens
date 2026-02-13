/**
 * S25: Remotion root — register composition(s) with session props.
 */

import React from "react";
import { Composition } from "remotion";
import { SessionReplay, defaultSessionReplayProps } from "./SessionReplay";
import {
  FileEvolutionComposition,
  defaultFileEvolutionProps,
} from "./FileEvolutionComposition";
import { Intro, defaultIntroPropsExport } from "./Intro";
import { FunReplay, defaultFunReplayProps } from "./FunReplay";
import {
  SessionWorkflow,
  defaultSessionWorkflowProps,
} from "./SessionWorkflow";
import { SessionReplaySchema } from "./schema";
import type { Session } from "./types/session";

const FPS = 30;
const WIDTH = 1280;
const HEIGHT = 720;

function getSessionDuration(session: Session): number {
  const n = session.events.length;
  if (n === 0) return FPS * 5;
  return n * 30;
}

const WORKFLOW_FRAMES_PER_EVENT = 30;
function getSessionWorkflowDuration(session: Session): number {
  const n = session.events.length;
  if (n === 0) return FPS * 5;
  return n * WORKFLOW_FRAMES_PER_EVENT;
}

function getFileEvolutionDuration(session: Session, path: string): number {
  const count = getFileRevisionCount(session, path);
  if (count === 0) return FPS * 10;
  return count * 60;
}

function getFileRevisionCount(session: Session, path: string): number {
  let count = 0;
  for (const event of session.events) {
    if (
      (event.type === "file_create" ||
        event.type === "file_edit" ||
        event.type === "file_delete") &&
      event.path === path
    ) {
      count++;
    }
  }
  return count;
}

const INTRO_DURATION_FRAMES = 150; // 5 sec @ 30fps

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Intro"
        component={Intro}
        defaultProps={defaultIntroPropsExport}
        durationInFrames={INTRO_DURATION_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="SessionReplay"
        component={
          SessionReplay as unknown as React.FC<Record<string, unknown>>
        }
        defaultProps={defaultSessionReplayProps}
        schema={SessionReplaySchema}
        durationInFrames={getSessionDuration(defaultSessionReplayProps.session)}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        calculateMetadata={({ props }) => ({
          durationInFrames: getSessionDuration(props.session),
        })}
      />
      <Composition
        id="FunReplay"
        component={FunReplay as unknown as React.FC<Record<string, unknown>>}
        defaultProps={defaultFunReplayProps}
        schema={SessionReplaySchema}
        durationInFrames={getSessionDuration(defaultFunReplayProps.session)}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        calculateMetadata={({ props }) => ({
          durationInFrames: getSessionDuration(props.session),
        })}
      />
      <Composition
        id="FileEvolution"
        component={
          FileEvolutionComposition as unknown as React.FC<
            Record<string, unknown>
          >
        }
        defaultProps={defaultFileEvolutionProps}
        durationInFrames={300}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        calculateMetadata={({ props }) => ({
          durationInFrames: getFileEvolutionDuration(
            props.session as Session,
            props.filePath as string,
          ),
        })}
      />
      <Composition
        id="SessionWorkflow"
        component={
          SessionWorkflow as unknown as React.FC<Record<string, unknown>>
        }
        defaultProps={defaultSessionWorkflowProps}
        schema={SessionReplaySchema}
        durationInFrames={getSessionWorkflowDuration(
          defaultSessionWorkflowProps.session,
        )}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        calculateMetadata={({ props }) => ({
          durationInFrames: getSessionWorkflowDuration(props.session),
        })}
      />
    </>
  );
};
