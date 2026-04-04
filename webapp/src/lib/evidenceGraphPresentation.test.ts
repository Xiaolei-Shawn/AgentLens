import { describe, expect, it } from "vitest";
import { presentEvidenceGraph } from "./evidenceGraphPresentation";
import type { EvidenceGraphResponse } from "./evidenceGraph";

const PATCH_EXCERPT = `*** Begin Patch
*** Add File: /Users/xiaoleishawn/private/AL/webapp/src/components/ContextPathView.css
+ .context-path {
+   display: grid;
+   gap: 1rem;
+ }
*** End Patch`;

describe("presentEvidenceGraph", () => {
  it("summarizes oversized patch-like output instead of exposing raw text as the main node label", () => {
    const response: EvidenceGraphResponse = {
      session_id: "sess_1",
      summary: {
        node_count: 3,
        edge_count: 2,
        prompt_count: 1,
        file_count: 1,
        endpoint_count: 0,
        memory_store_count: 0,
        background_worker_count: 0,
        output_count: 1,
        source_event_count: 3,
        confidence: "high",
      },
      nodes: [
        {
          id: "node_prompt",
          type: "prompt",
          label: "Create a context-path view for the trust graph",
          description: "The user asked for a clearer graph path UI.",
          event_ids: ["evt_1"],
        },
        {
          id: "node_file",
          type: "file",
          label: "/Users/xiaoleishawn/private/AL/webapp/src/components/ContextPathView.css",
          description: PATCH_EXCERPT,
          event_ids: ["evt_2"],
        },
        {
          id: "node_output",
          type: "output",
          label: PATCH_EXCERPT,
          description: PATCH_EXCERPT,
          event_ids: ["evt_3"],
        },
      ],
      edges: [
        { id: "edge_1", from: "node_prompt", to: "node_file", type: "writes", event_ids: ["evt_2"] },
        { id: "edge_2", from: "node_file", to: "node_output", type: "produces", event_ids: ["evt_3"] },
      ],
    };

    const presented = presentEvidenceGraph(response);
    const output = presented.nodes.find((node) => node.node.id === "node_output");

    expect(output?.primary_label).toBe("Patch update: ContextPathView.css");
    expect(output?.preview).toContain("hidden by default");
    expect(output?.raw_detail).toContain("*** Begin Patch");
  });

  it("derives readable key chains and hides low-value graph noise by default", () => {
    const response: EvidenceGraphResponse = {
      session_id: "sess_2",
      summary: {
        node_count: 9,
        edge_count: 6,
        prompt_count: 1,
        file_count: 2,
        endpoint_count: 1,
        memory_store_count: 1,
        background_worker_count: 1,
        output_count: 3,
        source_event_count: 6,
        confidence: "medium",
      },
      nodes: [
        { id: "prompt", type: "prompt", label: "Refactor trust review UI", event_ids: ["evt_1"] },
        { id: "file", type: "file", label: "/tmp/TrustReviewView.tsx", event_ids: ["evt_2"] },
        { id: "endpoint", type: "endpoint", label: "https://api.anthropic.com/v1/messages", event_ids: ["evt_3"] },
        { id: "worker", type: "background_worker", label: "history scanner", event_ids: ["evt_4"] },
        { id: "memory", type: "memory_store", label: "team memory", event_ids: ["evt_5"] },
        { id: "output1", type: "output", label: "summary output", event_ids: ["evt_6"] },
        { id: "output2", type: "output", label: "secondary output", event_ids: ["evt_7"] },
        { id: "output3", type: "output", label: "tertiary output", event_ids: ["evt_8"] },
        { id: "output4", type: "output", label: "quaternary output", event_ids: ["evt_9"] },
      ],
      edges: [
        { id: "e1", from: "prompt", to: "file", type: "writes", event_ids: ["evt_2"] },
        { id: "e2", from: "prompt", to: "endpoint", type: "sends", event_ids: ["evt_3"] },
        { id: "e3", from: "worker", to: "memory", type: "reads", event_ids: ["evt_4"] },
        { id: "e4", from: "file", to: "output1", type: "produces", event_ids: ["evt_6"] },
        { id: "e5", from: "output2", to: "output3", type: "produces", event_ids: ["evt_8"] },
        { id: "e6", from: "output3", to: "output4", type: "produces", event_ids: ["evt_9"] },
      ],
    };

    const presented = presentEvidenceGraph(response);

    expect(presented.key_chains[0]?.label).toContain("Refactor trust review UI");
    expect(presented.key_chains.length).toBeGreaterThan(0);
    expect(presented.hidden_node_ids.has("output4")).toBe(true);
  });
});
