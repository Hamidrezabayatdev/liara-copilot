"use client";

const CHANNEL_NAME = "liara-copilot-account";
const STORAGE_KEY = "liara-copilot-account-change";

export function broadcastAccountChange() {
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage("changed");
    channel.close();
  } catch {
    // BroadcastChannel can be unavailable in private/older browsers.
  }
  try {
    localStorage.setItem(STORAGE_KEY, `${Date.now()}-${crypto.randomUUID()}`);
  } catch {
    // Same-tab clearing still runs when browser storage is unavailable.
  }
}

export function subscribeToAccountChanges(listener: () => void) {
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener("message", listener);
  } catch {
    channel = null;
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    channel?.removeEventListener("message", listener);
    channel?.close();
    window.removeEventListener("storage", onStorage);
  };
}
