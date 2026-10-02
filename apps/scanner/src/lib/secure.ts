// Secrets on the phone, in the Keychain (iOS) or the Keystore (Android) through
// expo-secure-store: the person's session token while enrolling, the device token, the
// key of the event database, and which event the phone is enrolled in. Nothing here is
// backed up or synced: every item is bound to this device.

import { type GateDevice, gateDevice } from "@passripple/contracts";
import * as SecureStore from "expo-secure-store";
import { randomHex } from "./random.ts";

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const USER_SESSION = "user-session";
const DEVICE_TOKEN = "device-token";
const ENROLLMENT = "enrollment";
const dbKeyName = (deviceId: string) => `db-key-${deviceId}`;

export async function getUserSession(): Promise<string | null> {
  return SecureStore.getItemAsync(USER_SESSION, OPTIONS);
}

export async function setUserSession(token: string): Promise<void> {
  await SecureStore.setItemAsync(USER_SESSION, token, OPTIONS);
}

export async function clearUserSession(): Promise<void> {
  await SecureStore.deleteItemAsync(USER_SESSION, OPTIONS);
}

export async function getDeviceToken(): Promise<string | null> {
  return SecureStore.getItemAsync(DEVICE_TOKEN, OPTIONS);
}

/** The event the phone is enrolled in, as last known. */
export async function getEnrollment(): Promise<GateDevice | null> {
  const text = await SecureStore.getItemAsync(ENROLLMENT, OPTIONS);
  if (text === null) return null;
  try {
    const parsed = gateDevice.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function saveEnrollment(device: GateDevice, deviceToken?: string): Promise<void> {
  if (deviceToken !== undefined) await SecureStore.setItemAsync(DEVICE_TOKEN, deviceToken, OPTIONS);
  await SecureStore.setItemAsync(ENROLLMENT, JSON.stringify(device), OPTIONS);
}

/** The key of an event database: 32 random bytes, created once per enrolled device. */
export async function eventDbKey(deviceId: string): Promise<string> {
  const existing = await SecureStore.getItemAsync(dbKeyName(deviceId), OPTIONS);
  if (existing !== null) return existing;
  const key = randomHex(32);
  await SecureStore.setItemAsync(dbKeyName(deviceId), key, OPTIONS);
  return key;
}

/** Forgets the enrollment, its token and its database key. The database file goes separately. */
export async function forgetEnrollment(deviceId: string): Promise<void> {
  await SecureStore.deleteItemAsync(dbKeyName(deviceId), OPTIONS);
  await SecureStore.deleteItemAsync(DEVICE_TOKEN, OPTIONS);
  await SecureStore.deleteItemAsync(ENROLLMENT, OPTIONS);
}
