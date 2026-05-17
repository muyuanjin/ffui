import { queueStateLiteDeltaFromWire, queueStateLiteFromWire } from "@/lib/backend/queueContract";
import type { WireQueueStateLite, WireQueueStateLiteDelta } from "@/lib/backend/generated/queue-contracts";
import { subscribeTauriEvent, type SubscribeTauriEventOptions, type UnsubscribeFn } from "@/lib/tauriSubscriptions";
import type { QueueStateLite, QueueStateLiteDelta } from "@/types";

type QueueEventHandler<T> = (payload: T) => void | Promise<void>;

export const subscribeQueueStateLiteEvent = (
  handler: QueueEventHandler<QueueStateLite>,
  options: SubscribeTauriEventOptions = {},
): Promise<UnsubscribeFn> => {
  return subscribeTauriEvent<WireQueueStateLite>(
    "ffui://queue-state-lite",
    (payload) => handler(queueStateLiteFromWire(payload)),
    options,
  );
};

export const subscribeQueueStateLiteDeltaEvent = (
  handler: QueueEventHandler<QueueStateLiteDelta>,
  options: SubscribeTauriEventOptions = {},
): Promise<UnsubscribeFn> => {
  return subscribeTauriEvent<WireQueueStateLiteDelta>(
    "ffui://queue-state-lite-delta",
    (payload) => handler(queueStateLiteDeltaFromWire(payload)),
    options,
  );
};
