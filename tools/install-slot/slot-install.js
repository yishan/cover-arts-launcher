export const APP_SLOT_SIZE = 0x200000;
export const APP_SLOT_ADDRESSES = [0x180000, 0x380000, 0x580000];
export const COVER_REGION_ADDRESS = 0x780000;
export const COVER_BANK_SIZE = 0x10000;
export const TRUST_REGION_ADDRESS = 0x7e0000;
export const TRUST_BANK_SIZE = 0x1000;

export function recommendSlot(slots, sourceId) {
  const sameSource = sourceId && slots.find((slot) => slot.sourceId === sourceId && slot.state !== "empty");
  if (sameSource) return { slotId: sameSource.slotId, reason: "same-source" };
  const empty = slots.find((slot) => slot.state === "empty");
  if (empty) return { slotId: empty.slotId, reason: "first-empty" };
  return { slotId: null, reason: "manual-replacement" };
}

export function buildSlotWritePlan({ slotId, appLength, activeCoverBank, activeTrustBank, hasCover }) {
  if (!Number.isInteger(slotId) || slotId < 0 || slotId > 2) throw new Error("Slot id must be 0, 1, or 2.");
  if (!Number.isInteger(appLength) || appLength <= 0) throw new Error("App image length must be positive.");
  if (appLength > APP_SLOT_SIZE) throw new Error("App image exceeds 2 MiB (0x200000)." );
  const plan = {
    app: { address: APP_SLOT_ADDRESSES[slotId], eraseSize: APP_SLOT_SIZE, writeLength: appLength },
    trust: null,
    cover: null,
  };
  const trustBank = activeTrustBank === "a" ? "b" : "a";
  const trustBankIndex = slotId * 2 + (trustBank === "b" ? 1 : 0);
  plan.trust = {
    bank: trustBank,
    address: TRUST_REGION_ADDRESS + trustBankIndex * TRUST_BANK_SIZE,
    eraseSize: TRUST_BANK_SIZE,
  };
  if (hasCover) {
    const bank = activeCoverBank === "a" ? "b" : "a";
    const bankIndex = slotId * 2 + (bank === "b" ? 1 : 0);
    plan.cover = { bank, address: COVER_REGION_ADDRESS + bankIndex * COVER_BANK_SIZE, eraseSize: COVER_BANK_SIZE };
  }
  return plan;
}

export function buildSlotErasePlan(slotId) {
  if (!Number.isInteger(slotId) || slotId < 0 || slotId > 2) throw new Error("Slot id must be 0, 1, or 2.");
  return {
    app: { address: APP_SLOT_ADDRESSES[slotId], eraseSize: APP_SLOT_SIZE },
    covers: {
      address: COVER_REGION_ADDRESS + slotId * COVER_BANK_SIZE * 2,
      eraseSize: COVER_BANK_SIZE * 2,
    },
    trust: {
      address: TRUST_REGION_ADDRESS + slotId * TRUST_BANK_SIZE * 2,
      eraseSize: TRUST_BANK_SIZE * 2,
    },
  };
}

export function createSlotInstallSession(slotId) {
  return {
    slotId,
    phase: "created",
    bootable: false,
    deviceState: "not-installed",
    usePlaceholder: false,
    trusted: false,
    resumeAllowed: false,
    retryFrom: null,
    error: null,
  };
}

export function reduceSlotInstall(session, event) {
  if (["completed", "incomplete", "cancelled"].includes(session.phase)) return session;
  switch (event.type) {
    case "cancel":
      return { ...session, phase: "cancelled" };
    case "validation-complete":
      return session.phase === "created" ? { ...session, phase: "validated" } : session;
    case "begin":
      return session.phase === "validated" ? { ...session, phase: "writing-app" } : session;
    case "app-written":
      return session.phase === "writing-app" ? { ...session, phase: "verifying-app" } : session;
    case "app-verified":
      return session.phase === "verifying-app" ? { ...session, phase: "writing-trust" } : session;
    case "trust-written":
      return session.phase === "writing-trust" ? { ...session, phase: "writing-cover", bootable: true, trusted: true, deviceState: "bootable" } : session;
    case "cover-written":
    case "cover-retry-succeeded":
      return ["writing-cover", "partial-success"].includes(session.phase)
        ? { ...session, phase: "completed", bootable: true, deviceState: "bootable", usePlaceholder: false, error: null }
        : session;
    case "finish-without-cover":
      return ["writing-cover", "partial-success"].includes(session.phase)
        ? { ...session, phase: "completed", bootable: true, deviceState: "bootable", usePlaceholder: true }
        : session;
    case "app-write-failed":
    case "app-verification-failed":
    case "trust-write-failed":
      return {
        ...session,
        phase: "incomplete",
        bootable: event.cleanupVerified ? false : null,
        deviceState: event.cleanupVerified ? "unbootable" : "unknown",
        cleanupError: event.cleanupError ?? null,
        resumeAllowed: false,
        retryFrom: "app-erase", error: event.error ?? "App installation failed.",
      };
    case "cover-write-failed":
      return session.phase === "writing-cover" ? {
          ...session, phase: "partial-success", bootable: true, deviceState: "bootable", usePlaceholder: true,
          resumeAllowed: false, retryFrom: "cover-only", error: event.error ?? "Cover installation failed.",
        } : session;
    default:
      return session;
  }
}

export async function runSlotInstall({
  slotId,
  hasCover,
  eraseApp,
  writeApp,
  verifyApp,
  invalidateApp,
  writeTrust,
  writeCover,
}) {
  let session = createSlotInstallSession(slotId);
  session = reduceSlotInstall(session, { type: "validation-complete" });
  session = reduceSlotInstall(session, { type: "begin" });

  try {
    await eraseApp();
    await writeApp();
    session = reduceSlotInstall(session, { type: "app-written" });
    await verifyApp();
    session = reduceSlotInstall(session, { type: "app-verified" });
    await writeTrust();
    session = reduceSlotInstall(session, { type: "trust-written" });
  } catch (error) {
    let cleanupVerified = false;
    let cleanupError = null;
    try {
      cleanupVerified = await invalidateApp() === true;
    } catch (failure) {
      cleanupError = failure;
    }
    session = reduceSlotInstall(session, {
      type: session.phase === "verifying-app" ? "app-verification-failed"
        : session.phase === "writing-trust" ? "trust-write-failed" : "app-write-failed",
      error: error.message,
      cleanupVerified,
      cleanupError: cleanupError?.message ?? null,
    });
    return { session, error, cleanupError };
  }

  if (!hasCover) {
    session = reduceSlotInstall(session, { type: "finish-without-cover" });
    return { session, error: null, cleanupError: null };
  }

  try {
    await writeCover();
    session = reduceSlotInstall(session, { type: "cover-written" });
    return { session, error: null, cleanupError: null };
  } catch (error) {
    session = reduceSlotInstall(session, { type: "cover-write-failed", error: error.message });
    return { session, error, cleanupError: null };
  }
}
