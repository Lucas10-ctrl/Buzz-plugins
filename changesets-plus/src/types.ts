// The slices of Buzz's host types this plugin uses (from block/buzz-app,
// Apache-2.0). The host passes the full objects; these name what is read.
import type { CanvasHead } from "./canvas";

export type HostProcess = {
  write(data: string): Promise<void>;
  end(data?: string): Promise<void>;
  kill(): Promise<void>;
  exited: Promise<number | null>;
};
export type HostProcessOptions = {
  args?: readonly string[];
  cwd?: string;
  env?: Record<string, string>;
  onStdout?(data: string): void;
  onStderr?(data: string): void;
};
export type Host = {
  spawn?: (id: string, options?: HostProcessOptions) => Promise<HostProcess>;
};

export type ChannelMessage = Readonly<{
  id: string;
  channelId: string;
  authorId: string;
  createdAt: number;
  createdAtMs?: number;
  threadRootId?: string | undefined;
  content?: string;
}>;

export type LocalWork = Readonly<{
  scope: string;
  agent: string;
  channelId: string;
  messageId: string;
  thread?: boolean;
  threadRootId?: string;
  startedAt: number;
  state: "waiting" | "working" | "done" | "error" | "superseded" | "stopped";
  publishedMessageIds?: readonly string[];
}>;

export type RelaySession = {
  viewer?: string;
  canvas?: Readonly<{
    available: boolean;
    read(channelId: string): Promise<CanvasHead | null | undefined>;
  }>;
  agentChoices: {
    snapshot(): {
      identities: readonly { pubkey: string; execution?: string }[];
    };
  };
  agentActivity: {
    activate(): () => void;
    snapshot(): { local?: readonly LocalWork[] };
    subscribe(listener: () => void): () => void;
  };
};
