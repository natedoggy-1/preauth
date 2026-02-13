// app/lib/storage.ts
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const PREFIX = "hyve.";
const canUseSecureStore = Platform.OS !== "web";

async function safeSecureGet(key: string) {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function safeSecureSet(key: string, value: string) {
  try {
    await SecureStore.setItemAsync(key, value);
    return true;
  } catch {
    return false;
  }
}

async function safeSecureDelete(key: string) {
  try {
    await SecureStore.deleteItemAsync(key);
    return true;
  } catch {
    return false;
  }
}

function webGet(key: string) {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function webSet(key: string, value: string) {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function webRemove(key: string) {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export const Storage = {
  async getItem(key: string): Promise<string | null> {
    const k = key.startsWith(PREFIX) ? key : `${PREFIX}${key}`;
    if (canUseSecureStore) {
      const v = await safeSecureGet(k);
      if (v !== null && v !== undefined) return v;
    }
    return webGet(k);
  },

  async setItem(key: string, value: string): Promise<void> {
    const k = key.startsWith(PREFIX) ? key : `${PREFIX}${key}`;
    const v = String(value ?? "");
    if (canUseSecureStore) {
      const ok = await safeSecureSet(k, v);
      if (ok) return;
    }
    webSet(k, v);
  },

  async removeItem(key: string): Promise<void> {
    const k = key.startsWith(PREFIX) ? key : `${PREFIX}${key}`;
    if (canUseSecureStore) {
      const ok = await safeSecureDelete(k);
      if (ok) return;
    }
    webRemove(k);
  },

  async deleteItem(key: string): Promise<void> {
    return this.removeItem(key);
  },
};

export const Keys = {
  baseUrl: "baseUrl",
  apiKey: "apiKey",
  facilityId: "facilityId",

  // cross-tab local-only selection
  activePatient: "activePatient",

  // local-only PHI cache (per patient_id)
  patientPhiPrefix: "patientPHI:", // + patient_id

  // facility metadata (local-only; used for PHI reinsertion, never sent to server)
  facilityName: "facilityName",
  facilityNpi: "facilityNpi",
  facilityPhone: "facilityPhone",
  facilityFax: "facilityFax",
  facilityAddress: "facilityAddress",
  facilityCity: "facilityCity",
  facilityState: "facilityState",
  facilityZip: "facilityZip",

  // ✅ NEW: provider selection (persists across tabs)
  activeProviderId: "activeProviderId",

  // ✅ NEW: last used letter type
  lastLetterType: "lastLetterType",
};